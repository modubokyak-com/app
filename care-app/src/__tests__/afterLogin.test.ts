// 로그인·동의 직후 갈 곳(navigation/afterLogin.ts) — 저장·네트워크 모듈은 흉내만 낸다.
const mockCommit = jest.fn();
const mockLoadDraft = jest.fn();
const mockResultParamsOf = jest.fn();
const mockCheckItems = jest.fn();
const mockGetPatientId = jest.fn<Promise<string | null>, []>();
const mockResync = jest.fn(() => Promise.resolve());

jest.mock("../lib/quickCheckDraft", () => ({
  commitQuickCheckDraft: (pid: string) => mockCommit(pid),
  loadDraft: () => mockLoadDraft(),
  resultParamsOf: (d: unknown) => mockResultParamsOf(d),
}));
jest.mock("../lib/quickCheck", () => ({ checkItems: (d: unknown) => mockCheckItems(d) }));
jest.mock("../lib/storage", () => ({ getPatientId: () => mockGetPatientId() }));
jest.mock("../lib/alarmSync", () => ({ resyncAllAlarms: () => mockResync() }));

import { continueAfterLogin } from "../navigation/afterLogin";

const committedDraft = { findings: [{ kind: "priority" }], names: ["타이레놀", "와파린"] };
const leftoverDraft = { findings: [{ kind: "timing" }], names: ["철분", "칼슘"] };
const resultParams = { findings: committedDraft.findings, names: committedDraft.names };

let nav: { reset: jest.Mock };
let warn: jest.SpyInstance;

beforeEach(() => {
  jest.resetAllMocks();
  mockResync.mockImplementation(() => Promise.resolve());
  mockGetPatientId.mockResolvedValue("p1");
  mockCommit.mockResolvedValue(committedDraft);
  mockLoadDraft.mockResolvedValue(null);
  mockResultParamsOf.mockReturnValue(resultParams);
  mockCheckItems.mockImplementation((d: { names: string[] }) => d.names);
  nav = { reset: jest.fn() };
  warn = jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

describe("continueAfterLogin — save(결과 화면 저장 카드에서 로그인)", () => {
  it("저장에 성공하면 [홈, 결과(params), 알람 설정(from login, saved true)] 로 쌓는다", async () => {
    await continueAfterLogin(nav, { purpose: "save", isNew: true });
    expect(mockCommit).toHaveBeenCalledWith("p1");
    expect(nav.reset).toHaveBeenCalledWith({
      index: 2,
      routes: [
        { name: "Tabs" },
        { name: "QuickCheckResult", params: resultParams },
        { name: "VoiceGuide", params: { medicines: ["타이레놀", "와파린"], from: "login", saved: true } },
      ],
    });
  });

  it("저장이 던져도(초안은 남음) 초안에서 결과를 읽어 params 없이 열고 saved는 false", async () => {
    mockCommit.mockRejectedValue(new Error("network"));
    mockLoadDraft.mockResolvedValue(leftoverDraft);
    await continueAfterLogin(nav, { purpose: "save", isNew: true });
    expect(nav.reset).toHaveBeenCalledWith({
      index: 2,
      routes: [
        { name: "Tabs" },
        { name: "QuickCheckResult" },
        { name: "VoiceGuide", params: { medicines: ["철분", "칼슘"], from: "login", saved: false } },
      ],
    });
  });

  it("저장할 초안이 없으면(commit이 null) saved false — 초안에도 결과가 없으면 결과 화면 없이 [홈, 알람 설정]", async () => {
    mockCommit.mockResolvedValue(null);
    await continueAfterLogin(nav, { purpose: "save", medicines: ["아스피린"], isNew: true });
    expect(nav.reset).toHaveBeenCalledWith({
      index: 1,
      routes: [
        { name: "Tabs" },
        { name: "VoiceGuide", params: { medicines: ["아스피린"], from: "login", saved: false } },
      ],
    });
  });

  it("환자 id가 없으면 저장을 시도하지 않고 saved false", async () => {
    mockGetPatientId.mockResolvedValue(null);
    mockLoadDraft.mockResolvedValue(leftoverDraft);
    await continueAfterLogin(nav, { purpose: "save", isNew: true });
    expect(mockCommit).not.toHaveBeenCalled();
    const { routes } = nav.reset.mock.calls[0][0];
    expect(routes[routes.length - 1]).toEqual({
      name: "VoiceGuide", params: { medicines: ["철분", "칼슘"], from: "login", saved: false },
    });
  });

  it("넘겨받은 medicines가 있으면 초안의 이름(checkItems)보다 우선한다", async () => {
    await continueAfterLogin(nav, { purpose: "save", medicines: ["비타민C"], isNew: true });
    const { routes } = nav.reset.mock.calls[0][0];
    expect(routes[2].params).toEqual({ medicines: ["비타민C"], from: "login", saved: true });
  });

  it("medicines가 비었거나 없으면 checkItems로 되돌아간다", async () => {
    await continueAfterLogin(nav, { purpose: "save", medicines: [], isNew: true });
    await continueAfterLogin(nav, { purpose: "save", isNew: true });
    for (const [arg] of nav.reset.mock.calls) {
      expect(arg.routes[2].params.medicines).toEqual(["타이레놀", "와파린"]);
    }
    expect(nav.reset).toHaveBeenCalledTimes(2);
  });

  it("쓰던 계정(isNew false)이면 알람을 다시 예약한다", async () => {
    await continueAfterLogin(nav, { purpose: "save", isNew: false });
    expect(mockResync).toHaveBeenCalledTimes(1);
  });
});

describe("continueAfterLogin — skip · returning", () => {
  it("skip + 처음 가입 → 알람 물음(AlarmPrompt), 알람 재예약 없음", async () => {
    await continueAfterLogin(nav, { purpose: "skip", isNew: true });
    expect(nav.reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: "AlarmPrompt" }] });
    expect(mockResync).not.toHaveBeenCalled();
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it("skip + 쓰던 계정 → 홈(Tabs), 알람을 다시 예약한다", async () => {
    await continueAfterLogin(nav, { purpose: "skip", isNew: false });
    expect(nav.reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: "Tabs" }] });
    expect(mockResync).toHaveBeenCalledTimes(1);
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it("returning도 skip과 같다 — 처음이면 AlarmPrompt, 아니면 Tabs", async () => {
    await continueAfterLogin(nav, { purpose: "returning", isNew: true });
    await continueAfterLogin(nav, { purpose: "returning", isNew: false });
    expect(nav.reset.mock.calls.map(([arg]) => arg.routes[0].name)).toEqual(["AlarmPrompt", "Tabs"]);
  });
});
