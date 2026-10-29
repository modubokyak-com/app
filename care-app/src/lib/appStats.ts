import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import { AppState, Platform } from "react-native";
import type { AppStateStatus } from "react-native";
import { isSupabaseConfigured, supabase } from "./supabase";
import { getPatientId } from "./storage";
import type { LoginPurpose } from "../navigation/types";

// 앱 이용 통계 — 설치 → 인트로 → 1분 점검 → 결과 → 로그인 → 동의 → 첫 알람까지 어디서 멈추는지 보는 익명 퍼널.
// 한 줄씩 app_events(insert 전용)에 넣는다. 로그인 전엔 anon, 뒤엔 authenticated로 나가는데 둘 다 SELECT 권한이
// 없으니 insert 뒤에 .select()를 붙이면 안 된다(돌려받는 행을 읽다 실패한다).
//  · device_id  앱이 만든 무작위 설치 번호. 이 기기 AsyncStorage에만 두고 90일마다 새로 만든다. 계정·환자 id와 잇지 않는다.
//  · session_id 실행 한 번(또는 30분 넘게 쉬다 돌아온 때)마다 새로.
//  · 약·영양제 이름, 연령대, 건강 상태, 점검 결과, 이름, 계정·환자 id는 어떤 경우에도 싣지 않는다 —
//    보내는 행은 아래 buildRow 한 곳에서만 만들고, 호출하는 쪽이 넘긴 값은 허용 목록으로 걸러 쓴다.
// 베스트에포트 — analytics.ts와 같다. 어떤 실패도 던지지 않고 화면·알람을 막지 않는다.
// 저장 키(care.stats.*)는 storage.clearAll()에 넣지 않는다: 로그아웃해도 설치 번호와 「끄기」 선택은 그대로여야 한다.

export type AppEvent =
  | "first_open" | "app_open" | "screen" | "intro_cta"
  | "check_supp" | "check_rx" | "check_profile" | "check_report" | "check_failed"
  | "login_tap" | "login_done" | "signup_done" | "alarm_set" | "alarm_skip";

export type StatsLoginMethod = "kakao" | "apple" | "email";

export type AppEventExtra = {
  screen?: string;
  purpose?: LoginPurpose;
  method?: StatsLoginMethod;
  isNew?: boolean;
};

type AppEventRow = {
  device_id: string;
  session_id: string;
  event: AppEvent;
  screen: string | null;
  purpose: LoginPurpose | null;
  method: StatsLoginMethod | null;
  is_new: boolean | null;
  signed_in: boolean;
  platform: "ios" | "android";
  app_version: string | null;
};

const OFF_KEY = "care.stats.off";             // "1"이면 보내지 않는다(기본은 켜짐)
const INSTALLED_KEY = "care.stats.installed"; // 이 설치가 통계를 한 번이라도 시작했나 — first_open을 한 번만 보내려고
const DEVICE_KEY = "care.stats.device";       // JSON { id, at(ms) } — at은 번호를 만든 때

const DEVICE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const SESSION_GAP_MS = 30 * 60 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCREEN_RE = /^[A-Za-z]{1,40}$/;
const VERSION_RE = /^[0-9A-Za-z.+-]{1,20}$/;
const PURPOSES: readonly string[] = ["save", "skip", "returning"];
const METHODS: readonly string[] = ["kakao", "apple", "email"];

let started = false;
let sessionId: string | null = null;
let lastActivityAt = Date.now();
let lastScreenKey: string | null = null;
let enabled: boolean | null = null; // null = 아직 안 읽음
let devicePromise: Promise<string | null> | null = null;
// 이벤트를 부른 순서대로 처리한다(first_open → app_open → 화면 …). 네트워크 응답은 기다리지 않는다.
let queue: Promise<void> = Promise.resolve();

// 켜져 있나. 기본 켜짐 — 꺼 둔 기록("1")이 있을 때만 끈다.
export async function getAppStatsEnabled(): Promise<boolean> {
  if (enabled !== null) return enabled;
  try {
    const off = (await AsyncStorage.getItem(OFF_KEY)) === "1";
    enabled ??= !off; // 읽는 사이 setAppStatsEnabled가 바꿨으면 그 값이 이긴다
    return enabled;
  } catch {
    // 끄셨는지 알 수 없으면 보내지 않는다 — 끈 사람에게 보내는 쪽이 더 나쁘다. 캐시하지 않아 다음에 다시 읽는다.
    return false;
  }
}

// 켜고 끈다. 끌 때는 보내기를 곧바로 멈추고 저장된 설치 번호도 지운다(웹 통계의 「끄기」도 번호를 지운다).
// 저장에 실패하면 던진다 — 화면이 스위치를 되돌릴 수 있게.
export async function setAppStatsEnabled(on: boolean): Promise<void> {
  const prev = enabled;
  enabled = on;
  if (on) {
    try { await AsyncStorage.removeItem(OFF_KEY); } catch (e) { enabled = prev; throw e; }
    return;
  }
  const pending = devicePromise; // 번호를 만드는 중이면 끝난 뒤에 지워야 되살아나지 않는다
  devicePromise = null;
  try { await AsyncStorage.setItem(OFF_KEY, "1"); } catch (e) { enabled = prev; throw e; }
  await pending;
  await AsyncStorage.removeItem(DEVICE_KEY);
}

// 설치 번호 — 저장된 것이 90일 안이면 그대로, 아니면 새로. 첫 호출들이 겹쳐도 하나만 만들도록 프라미스를 캐시한다.
function getDeviceId(): Promise<string | null> {
  devicePromise ??= loadDeviceId().then((id) => {
    if (id === null) devicePromise = null; // 만들지 못했으면 다음에 다시
    return id;
  });
  return devicePromise;
}

async function loadDeviceId(): Promise<string | null> {
  try {
    const now = Date.now();
    try {
      const raw = await AsyncStorage.getItem(DEVICE_KEY);
      const d = raw ? JSON.parse(raw) : null;
      const age = typeof d?.at === "number" ? now - d.at : -1; // 시계가 거꾸로 간 기록(age<0)은 믿지 않는다
      if (typeof d?.id === "string" && UUID_RE.test(d.id) && age >= 0 && age < DEVICE_TTL_MS) return d.id;
    } catch {
      // 깨진 기록 — 새로 만든다
    }
    if (enabled === false) return null; // 끄는 중에 번호를 새로 남기지 않는다
    const id = Crypto.randomUUID();
    // 저장하지 못해도 이번 실행에서는 이 번호를 쓴다(프라미스 캐시)
    await AsyncStorage.setItem(DEVICE_KEY, JSON.stringify({ id, at: now })).catch(() => {});
    return id;
  } catch {
    return null;
  }
}

async function buildRow(event: AppEvent, extra: AppEventExtra | undefined, sid: string): Promise<AppEventRow | null> {
  const platform = Platform.OS;
  if (platform !== "ios" && platform !== "android") return null;
  let screen: string | null = null;
  if (event === "screen") {
    // 화면 이름은 라우트 이름뿐이어야 한다 — 모양이 다르면 보내지 않는다.
    if (typeof extra?.screen !== "string" || !SCREEN_RE.test(extra.screen)) return null;
    screen = extra.screen;
  }
  const deviceId = await getDeviceId();
  if (!deviceId) return null;
  const version = Constants.expoConfig?.version;
  return {
    device_id: deviceId,
    session_id: sid,
    event,
    screen,
    purpose: extra?.purpose && PURPOSES.includes(extra.purpose) ? extra.purpose : null,
    method: extra?.method && METHODS.includes(extra.method) ? extra.method : null,
    is_new: typeof extra?.isNew === "boolean" ? extra.isNew : null,
    signed_in: (await getPatientId()) !== null,
    platform,
    app_version: typeof version === "string" && VERSION_RE.test(version) ? version : null,
  };
}

async function send(event: AppEvent, extra: AppEventExtra | undefined, sid: string): Promise<void> {
  try {
    if (!isSupabaseConfigured || !(await getAppStatsEnabled())) return;
    const row = await buildRow(event, extra, sid);
    if (!row || enabled === false) return; // 행을 만드는 사이 껐으면 보내지 않는다
    // 기다리지 않는다 — 느린 네트워크가 뒤 이벤트를 막지 않게. 던진 것도, 돌아온 error도 버린다.
    void Promise.resolve(supabase.from("app_events").insert(row)).catch(() => {});
  } catch {
    // 무시 — 통계 실패가 앱 동작에 영향 주지 않게.
  }
}

function enqueue(event: AppEvent, extra: AppEventExtra | undefined, sid: string): void {
  queue = queue.then(() => send(event, extra, sid)).catch(() => {});
}

// 시작할 때 한 번: 설치 표시 → first_open(이 설치의 첫 실행만) → app_open.
async function begin(sid: string): Promise<void> {
  // 설치 표시는 통계를 꺼 둔 기기에도 남긴다 — 나중에 켰을 때 옛 설치가 새 설치로 세어지지 않게.
  let firstOpen = false;
  try {
    if ((await AsyncStorage.getItem(INSTALLED_KEY)) === null) {
      await AsyncStorage.setItem(INSTALLED_KEY, "1");
      firstOpen = true;
    }
  } catch {
    // 표시를 못 남기면 first_open도 보내지 않는다 — 실행마다 새 설치로 세는 것보다 낫다.
  }
  if (!(await getAppStatsEnabled())) return;
  if (firstOpen) await send("first_open", undefined, sid);
  await send("app_open", undefined, sid);
}

// 앱이 다시 앞으로 올 때: 30분 넘게 쉬었으면 새 실행으로 센다.
// 화면을 떠난 때도 활동으로 친다 — 한 화면을 오래 읽기만 한 사람이 알림창 한 번에 새 실행이 되지 않게.
function onAppState(state: AppStateStatus): void {
  try {
    const now = Date.now();
    if (state !== "active") { lastActivityAt = now; return; }
    const idle = now - lastActivityAt;
    lastActivityAt = now;
    if (idle < SESSION_GAP_MS) return;
    const sid = Crypto.randomUUID();
    sessionId = sid;
    devicePromise = null; // 오래 켜 둔 앱도 설치 번호의 90일을 다시 본다
    enqueue("app_open", undefined, sid);
  } catch {
    // 무시
  }
}

// 앱을 켤 때 한 번 부른다. 꺼 둔 기기에서는 설치 표시 말고는 아무것도 하지 않는다.
// 리스너는 켜짐 여부와 상관없이 달아 둔다 — 실행 중에 켜도 새 실행 구분이 되도록(꺼져 있으면 send가 막는다).
export function startAppStats(): void {
  if (started) return;
  started = true;
  try {
    lastActivityAt = Date.now();
    sessionId ??= Crypto.randomUUID();
    AppState.addEventListener("change", onAppState);
    const sid = sessionId;
    queue = queue.then(() => begin(sid)).catch(() => {});
  } catch {
    // 통계 때문에 앱이 안 켜지면 안 된다.
  }
}

// 이벤트 하나를 보낸다. 기다릴 필요 없고 던지지 않는다.
// startAppStats보다 먼저 불려도(자식 effect가 먼저 도는 경우) 시작부터 하므로 first_open/app_open 뒤에 온다.
export function trackApp(event: AppEvent, extra?: AppEventExtra): void {
  try {
    startAppStats();
    if (!sessionId) return;
    lastActivityAt = Date.now();
    enqueue(event, extra, sessionId);
  } catch {
    // 무시
  }
}

// 화면이 바뀔 때 NavigationContainer(onReady·onStateChange)가 부른다. onStateChange는 파라미터만 바뀌어도
// 불리므로 같은 라우트 키면 건너뛴다. 로그인 이유(purpose)만 params에서 꺼내고 나머지 params는 보지 않는다.
export function trackScreen(route: { key?: string; name: string; params?: object } | undefined): void {
  try {
    if (!route) return;
    const key = route.key ?? route.name;
    if (key === lastScreenKey) return;
    lastScreenKey = key;
    const purpose = (route.params as { purpose?: unknown } | undefined)?.purpose;
    trackApp("screen", {
      screen: route.name,
      purpose: typeof purpose === "string" && PURPOSES.includes(purpose) ? (purpose as LoginPurpose) : undefined,
    });
  } catch {
    // 무시
  }
}
