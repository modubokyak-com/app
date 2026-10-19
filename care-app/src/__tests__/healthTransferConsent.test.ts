const mockValues = new Map<string, string>();
const mockAlert = jest.fn();
let mockPatientId: string | null = null;

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn((key: string) => Promise.resolve(mockValues.get(key) ?? null)),
    setItem: jest.fn((key: string, value: string) => { mockValues.set(key, value); return Promise.resolve(); }),
    removeItem: jest.fn((key: string) => { mockValues.delete(key); return Promise.resolve(); }),
  },
}));
jest.mock("react-native", () => ({ Alert: { alert: (...args: unknown[]) => mockAlert(...args) } }));
jest.mock("../lib/storage", () => ({ getPatientId: jest.fn(() => Promise.resolve(mockPatientId)) }));

import {
  DISCLOSURE_SCOPES, clearHealthTransferConsents, hasHealthTransferConsent, healthTransferDisclosure, requestHealthTransferConsent,
} from "../lib/healthTransferConsent";

beforeEach(() => {
  mockValues.clear();
  mockAlert.mockReset();
  mockPatientId = null;
});

// 2026-10-19: 약 이름 검색·1분 점검·약 설명 조회의 동의창은 뺐다. 사진(OpenAI) 전송만 남는다.
it("사진(OpenAI) 전송 고지만 남아 있고 항목·수신자를 적는다", () => {
  expect(Object.keys(DISCLOSURE_SCOPES)).toEqual(["photo-ocr"]);
  expect(healthTransferDisclosure("photo-ocr").title).toContain("사진");
  expect(healthTransferDisclosure("photo-ocr").message).toContain("사진");
  expect(healthTransferDisclosure("photo-ocr").message).toContain("OpenAI");
});

it("명시적으로 동의한 동일 계정에서만 재사용한다", async () => {
  mockPatientId = "patient-a";
  mockAlert.mockImplementation((_title, _message, buttons) => buttons[1].onPress());
  await expect(requestHealthTransferConsent("photo-ocr")).resolves.toBe(true);
  await expect(hasHealthTransferConsent("photo-ocr")).resolves.toBe(true);
  expect(mockAlert).toHaveBeenCalledTimes(1);

  await expect(requestHealthTransferConsent("photo-ocr")).resolves.toBe(true);
  expect(mockAlert).toHaveBeenCalledTimes(1);

  mockPatientId = "patient-b";
  await expect(hasHealthTransferConsent("photo-ocr")).resolves.toBe(false);
});

it("거절하면 동의를 저장하지 않는다", async () => {
  mockAlert.mockImplementation((_title, _message, buttons) => buttons[0].onPress());
  await expect(requestHealthTransferConsent("photo-ocr")).resolves.toBe(false);
  await expect(hasHealthTransferConsent("photo-ocr")).resolves.toBe(false);
});

it("로그아웃·계정 전환 정리를 위해 저장된 동의를 지울 수 있다", async () => {
  mockAlert.mockImplementation((_title, _message, buttons) => buttons[1].onPress());
  await requestHealthTransferConsent("photo-ocr");
  await expect(hasHealthTransferConsent("photo-ocr")).resolves.toBe(true);
  await clearHealthTransferConsents();
  await expect(hasHealthTransferConsent("photo-ocr")).resolves.toBe(false);
});
