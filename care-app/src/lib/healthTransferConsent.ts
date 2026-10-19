import AsyncStorage from "@react-native-async-storage/async-storage";
import { Alert } from "react-native";
import { getPatientId } from "./storage";

// 2026-10-19: 약 이름 검색·1분 점검·약 설명 조회의 동의창은 뺐다 — 자체 Supabase 서버(또는 약 이름 한 줄)만 가는 처리라
// 방침 고지로 충분하고, 로그인 전 흐름에 동의창이 끼어 어색하다는 팀 의견(2026-10-16). 사진(OpenAI) 전송만 동의를 받는다.
export type HealthTransferScope = "photo-ocr";

export const HEALTH_TRANSFER_CONSENT_VERSION = "2026-10-10.1";
const KEY = "care.healthTransferConsent.v1";
const ANONYMOUS_SUBJECT = "anonymous";

type ConsentEntry = { version: string; agreedAt: string };
type ConsentStore = {
  subject: string;
  scopes: Partial<Record<HealthTransferScope, ConsentEntry>>;
};

const DISCLOSURES: Record<HealthTransferScope, { title: string; message: string }> = {
  "photo-ocr": {
    title: "약 사진 전송 동의",
    message: [
      "전송 항목: 방금 선택하거나 촬영한 약봉투·의약품 사진",
      "목적: 사진에서 약 이름과 복약 일정을 인식하고 제품명 후보 확인",
      "수신자: (주)안팜이 이용하는 Supabase 서버·Edge Function 및 OpenAI",
      "",
      "동의하지 않으면 사진을 전송하지 않습니다.",
    ].join("\n"),
  },
};

let storageChain: Promise<unknown> = Promise.resolve();
const pendingPrompts = new Map<string, Promise<boolean>>();

function locked<T>(work: () => Promise<T>): Promise<T> {
  const next = storageChain.then(work, work);
  storageChain = next.then(() => undefined, () => undefined);
  return next;
}

function parseStore(raw: string | null): ConsentStore | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<ConsentStore>;
    if (typeof value.subject !== "string" || !value.scopes || typeof value.scopes !== "object") return null;
    return { subject: value.subject, scopes: value.scopes };
  } catch {
    return null;
  }
}

async function currentSubject(): Promise<string> {
  try {
    return (await getPatientId()) ?? ANONYMOUS_SUBJECT;
  } catch {
    return ANONYMOUS_SUBJECT;
  }
}

// 남아 있는 동의 범위 목록 — 테스트와 문서가 참조한다.
export const DISCLOSURE_SCOPES: Readonly<Record<HealthTransferScope, true>> = { "photo-ocr": true };

export function healthTransferDisclosure(scope: HealthTransferScope): { title: string; message: string } {
  return DISCLOSURES[scope];
}

export async function hasHealthTransferConsent(scope: HealthTransferScope, subject?: string): Promise<boolean> {
  const expected = subject ?? await currentSubject();
  return locked(async () => {
    const store = parseStore(await AsyncStorage.getItem(KEY));
    return store?.subject === expected && store.scopes[scope]?.version === HEALTH_TRANSFER_CONSENT_VERSION;
  });
}

export async function clearHealthTransferConsents(): Promise<void> {
  await locked(() => AsyncStorage.removeItem(KEY));
}

async function rememberConsent(scope: HealthTransferScope, subject: string): Promise<void> {
  await locked(async () => {
    const existing = parseStore(await AsyncStorage.getItem(KEY));
    const scopes = existing?.subject === subject ? existing.scopes : {};
    await AsyncStorage.setItem(KEY, JSON.stringify({
      subject,
      scopes: {
        ...scopes,
        [scope]: { version: HEALTH_TRANSFER_CONSENT_VERSION, agreedAt: new Date().toISOString() },
      },
    } satisfies ConsentStore));
  });
}

export async function requestHealthTransferConsent(scope: HealthTransferScope): Promise<boolean> {
  const subject = await currentSubject();
  if (await hasHealthTransferConsent(scope, subject)) return true;

  const promptKey = `${subject}:${scope}`;
  const existing = pendingPrompts.get(promptKey);
  if (existing) return existing;

  const disclosure = healthTransferDisclosure(scope);
  const pending = new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    Alert.alert(disclosure.title, disclosure.message, [
      { text: "동의하지 않음", style: "cancel", onPress: () => finish(false) },
      {
        text: "동의하고 계속",
        onPress: () => { void rememberConsent(scope, subject).then(() => finish(true), () => finish(false)); },
      },
    ], { cancelable: true, onDismiss: () => finish(false) });
  }).finally(() => pendingPrompts.delete(promptKey));

  pendingPrompts.set(promptKey, pending);
  return pending;
}
