// 앱 이용 통계(lib/appStats.ts) — 네이티브·네트워크 모듈은 흉내만 낸다.
// 모듈이 상태(세션·캐시·큐)를 갖고 있어서 테스트마다 jest.resetModules()로 새로 불러온다 = 앱을 새로 켠 것.
const mockValues = new Map<string, string>();
const mockInsert = jest.fn();
const mockFrom = jest.fn((_table: string) => ({ insert: mockInsert }));
let mockConfigured = true;
let mockOS = "ios";
let mockVersion: string | undefined = "1.2.3";
let mockPatientId: string | null = null;
let mockPatientIdFails = false;
let mockUuidCount = 0;
let mockNow = 1_800_000_000_000;
let mockAppStateCb: ((state: string) => void) | null = null;
const mockAddListener = jest.fn((_type: string, cb: (state: string) => void) => {
  mockAppStateCb = cb;
  return { remove: jest.fn() };
});

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn((key: string) => Promise.resolve(mockValues.get(key) ?? null)),
    setItem: jest.fn((key: string, value: string) => { mockValues.set(key, value); return Promise.resolve(); }),
    removeItem: jest.fn((key: string) => { mockValues.delete(key); return Promise.resolve(); }),
  },
}));
jest.mock("react-native", () => ({
  AppState: { addEventListener: (type: string, cb: (state: string) => void) => mockAddListener(type, cb) },
  Platform: { get OS() { return mockOS; } },
}));
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { get expoConfig() { return { version: mockVersion }; } },
}));
jest.mock("expo-crypto", () => ({
  randomUUID: () => `00000000-0000-4000-8000-${String(++mockUuidCount).padStart(12, "0")}`,
}));
jest.mock("../lib/storage", () => ({
  getPatientId: () => (mockPatientIdFails ? Promise.reject(new Error("storage")) : Promise.resolve(mockPatientId)),
}));
jest.mock("../lib/supabase", () => ({
  get isSupabaseConfigured() { return mockConfigured; },
  supabase: { from: (table: string) => mockFrom(table) },
}));

type Mod = typeof import("../lib/appStats");
function load(): Mod {
  jest.resetModules();
  mockAppStateCb = null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("../lib/appStats");
}

// 큐는 전부 마이크로태스크라 매크로태스크 한 번이면 다 흘러간다.
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const rows = (): Record<string, unknown>[] => mockInsert.mock.calls.map((c) => c[0]);
const events = () => rows().map((r) => r.event);

const DAY = 24 * 60 * 60 * 1000;
const MIN = 60 * 1000;
const COLUMNS = ["app_version", "device_id", "event", "is_new", "method", "platform", "purpose", "screen", "session_id", "signed_in"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OLD_ID = "11111111-1111-4111-8111-111111111111";
let nowSpy: jest.SpyInstance;

beforeEach(() => {
  mockValues.clear();
  mockInsert.mockReset();
  mockInsert.mockResolvedValue({ error: null });
  mockFrom.mockClear();
  mockAddListener.mockClear();
  mockConfigured = true;
  mockOS = "ios";
  mockVersion = "1.2.3";
  mockPatientId = null;
  mockPatientIdFails = false;
  mockUuidCount = 0;
  mockNow = 1_800_000_000_000;
  nowSpy = jest.spyOn(Date, "now").mockImplementation(() => mockNow);
});
afterEach(() => nowSpy.mockRestore());

describe("startAppStats", () => {
  it("첫 실행은 first_open 다음 app_open — 같은 설치·실행 번호, 컬럼은 정해진 열 가지뿐", async () => {
    const select = jest.fn();
    mockInsert.mockReturnValue(Object.assign(Promise.resolve({ error: null }), { select }));
    const stats = load();
    stats.startAppStats();
    await flush();

    expect(events()).toEqual(["first_open", "app_open"]);
    expect(mockFrom).toHaveBeenCalledWith("app_events");
    const [first, second] = rows();
    expect(Object.keys(first).sort()).toEqual(COLUMNS);
    expect(Object.keys(second).sort()).toEqual(COLUMNS);
    expect(first.device_id).toMatch(UUID_RE);
    expect(first.session_id).toMatch(UUID_RE);
    expect(first.device_id).not.toBe(first.session_id);
    expect(second.device_id).toBe(first.device_id);
    expect(second.session_id).toBe(first.session_id);
    expect(first).toMatchObject({
      screen: null, purpose: null, method: null, is_new: null, signed_in: false, platform: "ios", app_version: "1.2.3",
    });
    // .select() 없이 행 하나만 넘긴다 — anon·authenticated 모두 SELECT 권한이 없다.
    expect(mockInsert.mock.calls.every((c) => c.length === 1)).toBe(true);
    expect(select).not.toHaveBeenCalled();
    // 설치 표시와 설치 번호는 기기에 남는다.
    expect(mockValues.get("care.stats.installed")).toBe("1");
    expect(JSON.parse(mockValues.get("care.stats.device")!)).toEqual({ id: first.device_id, at: mockNow });
  });

  it("두 번째 실행(설치 표시 있음)은 app_open만 — 저장된 설치 번호를 그대로 쓴다", async () => {
    mockValues.set("care.stats.installed", "1");
    mockValues.set("care.stats.device", JSON.stringify({ id: OLD_ID, at: mockNow - 5 * DAY }));
    const stats = load();
    stats.startAppStats();
    await flush();

    expect(events()).toEqual(["app_open"]);
    expect(rows()[0].device_id).toBe(OLD_ID);
  });

  it("두 번 불러도 한 번만 시작한다(리스너·첫 이벤트 중복 없음)", async () => {
    const stats = load();
    stats.startAppStats();
    stats.startAppStats();
    await flush();

    expect(mockAddListener).toHaveBeenCalledTimes(1);
    expect(events()).toEqual(["first_open", "app_open"]);
  });

  it("끈 기기는 아무것도 보내지 않지만 설치 표시는 남긴다 — 나중에 켜도 새 설치로 세지 않는다", async () => {
    mockValues.set("care.stats.off", "1");
    const stats = load();
    stats.startAppStats();
    stats.trackApp("intro_cta");
    stats.trackScreen({ key: "k1", name: "Home" });
    await flush();

    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockValues.get("care.stats.installed")).toBe("1");
    expect(mockValues.has("care.stats.device")).toBe(false);
    await expect(stats.getAppStatsEnabled()).resolves.toBe(false);

    // 켠 뒤 다음 실행: first_open 없이 app_open
    await stats.setAppStatsEnabled(true);
    const next = load();
    next.startAppStats();
    await flush();
    expect(events()).toEqual(["app_open"]);
  });

  it("Supabase 설정이 없거나 ios·android가 아니면 보내지 않는다", async () => {
    mockConfigured = false;
    const a = load();
    a.startAppStats();
    await flush();
    expect(mockInsert).not.toHaveBeenCalled();

    mockConfigured = true;
    mockOS = "web";
    const b = load();
    b.startAppStats();
    b.trackApp("intro_cta");
    await flush();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("platform은 android도 그대로, signed_in은 저장된 환자 id가 있을 때만 true", async () => {
    mockOS = "android";
    mockPatientId = "patient-1";
    const stats = load();
    stats.startAppStats();
    await flush();

    expect(rows()[0]).toMatchObject({ platform: "android", signed_in: true });
    // 환자 id 값 자체는 어떤 열에도 들어가지 않는다.
    expect(JSON.stringify(rows())).not.toContain("patient-1");
  });

  it("app_version은 모양이 맞을 때만, 아니면 null", async () => {
    mockVersion = "1.0.0 (build; drop)";
    const a = load();
    a.startAppStats();
    await flush();
    expect(rows()[0].app_version).toBeNull();

    mockInsert.mockClear();
    mockVersion = undefined;
    const b = load();
    b.startAppStats();
    await flush();
    expect(rows()[0].app_version).toBeNull();
  });
});

describe("설치 번호", () => {
  it("90일이 지나면 새로 만들고, 그 전이면 그대로 쓴다", async () => {
    mockValues.set("care.stats.installed", "1");
    mockValues.set("care.stats.device", JSON.stringify({ id: OLD_ID, at: mockNow - 91 * DAY }));
    const stale = load();
    stale.startAppStats();
    await flush();
    const newId = rows()[0].device_id;
    expect(newId).not.toBe(OLD_ID);
    expect(newId).toMatch(UUID_RE);
    expect(JSON.parse(mockValues.get("care.stats.device")!)).toEqual({ id: newId, at: mockNow });

    mockInsert.mockClear();
    mockValues.set("care.stats.device", JSON.stringify({ id: OLD_ID, at: mockNow - 89 * DAY }));
    const fresh = load();
    fresh.startAppStats();
    await flush();
    expect(rows()[0].device_id).toBe(OLD_ID);
  });

  it("깨진 기록·UUID가 아닌 값·미래 시각은 믿지 않고 새로 만든다", async () => {
    mockValues.set("care.stats.installed", "1");
    for (const bad of ["not json", JSON.stringify({ id: "abc", at: mockNow }), JSON.stringify({ id: OLD_ID, at: mockNow + DAY })]) {
      mockInsert.mockClear();
      mockValues.set("care.stats.device", bad);
      const stats = load();
      stats.startAppStats();
      await flush();
      expect(rows()[0].device_id).not.toBe(OLD_ID);
      expect(rows()[0].device_id).toMatch(UUID_RE);
    }
  });

  it("처음 호출이 겹쳐도 하나만 만든다", async () => {
    const stats = load();
    stats.trackApp("intro_cta");
    stats.trackApp("check_supp");
    stats.trackApp("check_rx");
    await flush();

    const ids = new Set(rows().map((r) => r.device_id));
    expect(ids.size).toBe(1);
    const AsyncStorage = jest.requireMock("@react-native-async-storage/async-storage").default;
    const deviceWrites = AsyncStorage.setItem.mock.calls.filter((c: string[]) => c[0] === "care.stats.device");
    expect(deviceWrites).toHaveLength(1);
  });
});

describe("끄기·켜기", () => {
  it("끄면 보내기가 멈추고 저장된 설치 번호가 지워진다", async () => {
    const stats = load();
    stats.startAppStats();
    await flush();
    expect(mockValues.has("care.stats.device")).toBe(true);
    mockInsert.mockClear();

    await stats.setAppStatsEnabled(false);
    expect(mockValues.get("care.stats.off")).toBe("1");
    expect(mockValues.has("care.stats.device")).toBe(false);
    await expect(stats.getAppStatsEnabled()).resolves.toBe(false);

    stats.trackApp("intro_cta");
    stats.trackScreen({ key: "k2", name: "Login" });
    await flush();
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockValues.has("care.stats.device")).toBe(false);
  });

  it("다시 켜면 꺼 둔 표시가 지워지고, 새 설치 번호로 보낸다", async () => {
    const stats = load();
    stats.startAppStats();
    await flush();
    const before = rows()[0].device_id;
    await stats.setAppStatsEnabled(false);
    mockInsert.mockClear();

    await stats.setAppStatsEnabled(true);
    expect(mockValues.has("care.stats.off")).toBe(false);
    await expect(stats.getAppStatsEnabled()).resolves.toBe(true);
    stats.trackApp("intro_cta");
    await flush();
    expect(events()).toEqual(["intro_cta"]);
    expect(rows()[0].device_id).not.toBe(before);
  });

  it("기본은 켜짐", async () => {
    const stats = load();
    await expect(stats.getAppStatsEnabled()).resolves.toBe(true);
  });

  it("저장 실패는 던져서 화면이 알 수 있게 하고, 끄지 못했으면 계속 켜진 상태로 본다", async () => {
    const stats = load();
    const AsyncStorage = jest.requireMock("@react-native-async-storage/async-storage").default;
    AsyncStorage.setItem.mockRejectedValueOnce(new Error("disk full"));
    await expect(stats.setAppStatsEnabled(false)).rejects.toThrow("disk full");
    await expect(stats.getAppStatsEnabled()).resolves.toBe(true);
  });
});

describe("trackScreen", () => {
  it("라우트 이름 모양(영문 1~40자)이 아니면 보내지 않는다", async () => {
    const stats = load();
    stats.startAppStats();
    await flush();
    mockInsert.mockClear();

    stats.trackScreen({ key: "a", name: "Bad Name" });
    stats.trackScreen({ key: "b", name: "Tab2" });
    stats.trackScreen({ key: "c", name: "" });
    stats.trackScreen({ key: "d", name: "홈" });
    stats.trackScreen({ key: "e", name: "A".repeat(41) });
    stats.trackScreen(undefined);
    await flush();
    expect(mockInsert).not.toHaveBeenCalled();

    stats.trackScreen({ key: "f", name: "A".repeat(40) });
    stats.trackScreen({ key: "g", name: "QuickCheckInput" });
    await flush();
    expect(rows().map((r) => r.screen)).toEqual(["A".repeat(40), "QuickCheckInput"]);
  });

  it("같은 라우트 키가 이어지면(파라미터만 바뀜) 한 번만, 키가 다르면 이름이 같아도 센다", async () => {
    const stats = load();
    stats.startAppStats();
    await flush();
    mockInsert.mockClear();

    stats.trackScreen({ key: "home-1", name: "Home" });
    stats.trackScreen({ key: "home-1", name: "Home", params: { x: 1 } });
    stats.trackScreen({ key: "cab-1", name: "Cabinet" });
    stats.trackScreen({ key: "home-1", name: "Home" }); // 다른 화면을 거쳐 돌아온 것 — 센다
    stats.trackScreen({ key: "home-2", name: "Home" });
    await flush();

    expect(events()).toEqual(["screen", "screen", "screen", "screen"]);
    expect(rows().map((r) => r.screen)).toEqual(["Home", "Cabinet", "Home", "Home"]);
  });

  it("params.purpose가 save·skip·returning일 때만 purpose로 싣고, 다른 params는 보지 않는다", async () => {
    const stats = load();
    stats.startAppStats();
    await flush();
    mockInsert.mockClear();

    stats.trackScreen({ key: "1", name: "Login", params: { purpose: "save", medicines: ["비타민C", "아스피린"] } });
    stats.trackScreen({ key: "2", name: "Login", params: { purpose: "skip" } });
    stats.trackScreen({ key: "3", name: "Consent", params: { purpose: "returning", appleFullName: "홍길동" } });
    stats.trackScreen({ key: "4", name: "Login", params: { purpose: "weird" } });
    stats.trackScreen({ key: "5", name: "Home" });
    await flush();

    expect(rows().map((r) => r.purpose)).toEqual(["save", "skip", "returning", null, null]);
    const text = JSON.stringify(rows());
    expect(text).not.toContain("비타민C");
    expect(text).not.toContain("홍길동");
  });
});

describe("trackApp", () => {
  it("method·purpose·is_new는 허용된 값만, 모르는 값은 null", async () => {
    const stats = load();
    stats.startAppStats();
    await flush();
    mockInsert.mockClear();

    stats.trackApp("login_tap", { method: "kakao", purpose: "save" });
    stats.trackApp("login_done", { method: "email", purpose: "returning", isNew: false });
    stats.trackApp("signup_done", { purpose: "skip", isNew: true });
    stats.trackApp("login_tap", { method: "google", purpose: "x", isNew: "yes" } as never);
    await flush();

    expect(rows().map((r) => [r.event, r.method, r.purpose, r.is_new])).toEqual([
      ["login_tap", "kakao", "save", null],
      ["login_done", "email", "returning", false],
      ["signup_done", null, "skip", true],
      ["login_tap", null, null, null],
    ]);
  });

  it("넘긴 값에 다른 필드가 섞여 있어도 행에는 정해진 열만 들어간다", async () => {
    const stats = load();
    stats.startAppStats();
    await flush();
    mockInsert.mockClear();

    stats.trackApp("check_report", {
      medicines: ["와파린"], supplements: ["오메가3"], age: "70대", conditions: ["신장질환"],
      name: "홍길동", patientId: "p-1", screen: "Secret",
    } as never);
    stats.trackScreen({ key: "z", name: "Alarm", params: { scheduleId: "s-1", medName: "와파린", purpose: "save" } });
    await flush();

    expect(rows()).toHaveLength(2);
    for (const r of rows()) expect(Object.keys(r).sort()).toEqual(COLUMNS);
    // screen 열은 screen 이벤트에서만 — 다른 이벤트가 넘긴 screen은 버린다.
    expect(rows()[0].screen).toBeNull();
    const text = JSON.stringify(rows());
    for (const leak of ["와파린", "오메가3", "70대", "신장질환", "홍길동", "p-1", "s-1", "Secret"]) {
      expect(text).not.toContain(leak);
    }
  });

  it("시작보다 먼저 불려도 first_open·app_open 뒤에 온다", async () => {
    const stats = load();
    stats.trackApp("intro_cta");
    await flush();

    expect(events()).toEqual(["first_open", "app_open", "intro_cta"]);
  });
});

describe("실행(session) 번호", () => {
  it("30분 넘게 쉬었다 앞으로 오면 새 실행 번호와 app_open, 그 안이면 그대로", async () => {
    const stats = load();
    stats.startAppStats();
    await flush();
    const firstSession = rows()[0].session_id;
    const deviceId = rows()[0].device_id;
    mockInsert.mockClear();

    // 29분 — 같은 실행
    mockNow += 29 * MIN;
    mockAppStateCb!("background");
    mockNow += 29 * MIN;
    mockAppStateCb!("active");
    await flush();
    expect(mockInsert).not.toHaveBeenCalled();

    // 30분 — 새 실행
    mockNow += 1 * MIN;
    mockAppStateCb!("background");
    mockNow += 30 * MIN;
    mockAppStateCb!("active");
    await flush();
    expect(events()).toEqual(["app_open"]);
    expect(rows()[0].session_id).not.toBe(firstSession);
    expect(rows()[0].session_id).toMatch(UUID_RE);
    expect(rows()[0].device_id).toBe(deviceId);

    // 이후 이벤트는 새 실행 번호로
    stats.trackApp("intro_cta");
    await flush();
    expect(rows()[1].session_id).toBe(rows()[0].session_id);
  });

  it("앱을 쓰는 동안(이벤트·화면 이탈)은 활동으로 쳐서, 오래 켜 둔 뒤 잠깐 쉬어도 새 실행이 되지 않는다", async () => {
    const stats = load();
    stats.startAppStats();
    await flush();
    mockInsert.mockClear();

    mockNow += 25 * MIN;
    stats.trackApp("check_supp");
    mockNow += 25 * MIN; // 처음 시작으로부터 50분이지만 마지막 활동으로부터는 25분
    mockAppStateCb!("active");
    await flush();
    expect(events()).toEqual(["check_supp"]);
  });

  it("실행 번호가 바뀐 뒤 90일 지난 설치 번호도 다시 본다", async () => {
    const stats = load();
    stats.startAppStats();
    await flush();
    const firstDevice = rows()[0].device_id;
    mockInsert.mockClear();

    mockNow += 91 * DAY;
    mockAppStateCb!("background");
    mockNow += 31 * MIN;
    mockAppStateCb!("active");
    await flush();
    expect(rows()[0].device_id).not.toBe(firstDevice);
  });
});

describe("실패해도 던지지 않는다", () => {
  it("insert가 거절되거나 던지거나 error를 돌려줘도 어디로도 새지 않는다", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on("unhandledRejection", onUnhandled);
    try {
      const stats = load();

      mockInsert.mockRejectedValue(new Error("network"));
      expect(() => stats.startAppStats()).not.toThrow();
      expect(() => stats.trackApp("intro_cta")).not.toThrow();
      expect(() => stats.trackScreen({ key: "a", name: "Home" })).not.toThrow();
      await flush();

      mockInsert.mockImplementation(() => { throw new Error("sync boom"); });
      expect(() => stats.trackApp("check_supp")).not.toThrow();
      await flush();

      mockInsert.mockResolvedValue({ error: { message: "rls" } });
      expect(() => stats.trackApp("check_rx")).not.toThrow();
      await flush();

      // 실패한 뒤에도 큐가 막히지 않고 다음 이벤트가 나간다
      mockInsert.mockReset();
      mockInsert.mockResolvedValue({ error: null });
      stats.trackApp("check_profile");
      await flush();
      expect(events()).toEqual(["check_profile"]);
      // 거절 처리가 한 틱 늦게 도는 경우까지 기다린 뒤 확인
      await flush();
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("환자 id·저장소 읽기가 실패하면 그 이벤트만 건너뛰고 던지지 않는다", async () => {
    mockPatientIdFails = true;
    const stats = load();
    expect(() => stats.startAppStats()).not.toThrow();
    stats.trackApp("intro_cta");
    await flush();
    expect(mockInsert).not.toHaveBeenCalled();

    mockPatientIdFails = false;
    stats.trackApp("check_supp");
    await flush();
    expect(events()).toEqual(["check_supp"]);
  });

  it("꺼 두셨는지 읽지 못하면 보내지 않는다", async () => {
    // 모킹은 load() 뒤에 건다 — resetModules가 모킹 인스턴스도 새로 만든다.
    const stats = load();
    jest.requireMock("@react-native-async-storage/async-storage").default.getItem.mockRejectedValueOnce(new Error("read"));
    // 첫 읽기(설치 표시)는 실패 → first_open 없음, 두 번째 읽기(꺼짐 표시)는 정상 → app_open은 나간다
    stats.startAppStats();
    await flush();
    expect(events()).toEqual(["app_open"]);

    const next = load();
    jest.requireMock("@react-native-async-storage/async-storage").default.getItem.mockRejectedValueOnce(new Error("read"));
    await expect(next.getAppStatsEnabled()).resolves.toBe(false);
  });
});
