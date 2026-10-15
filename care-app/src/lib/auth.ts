import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as WebBrowser from "expo-web-browser";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import type { User } from "@supabase/supabase-js";
import { supabase, isSupabaseConfigured, AUTH_STORAGE_KEY } from "./supabase";
import {
  parseAuthCallback, isUserCanceled, formatAppleFullName, bytesToHex, kakaoAuthorizeUrl, parseKakaoSession,
  normalizeEmail, validateEmailLogin, emailAuthErrorMessage,
} from "./authHelpers";

export { hasStoredSession } from "./supabase";
export { displayNameFrom, loginProviderLabel, loginProviderOf } from "./authHelpers";

// 로그인 — 교체 가능한 좁은 경계 (회의 2026-10-08).
// 간편 로그인: 안드로이드는 카카오, iOS는 카카오 + Apple(App Store 가이드라인 4.8).
// 이메일·비밀번호 로그인(2026-10-15 추가): 스토어 심사자가 들어올 길과 카카오·Apple을 못 쓰는 사람용.
//   Supabase Auth 이메일 제공자, 가입 확인 메일 없음(mailer_autoconfirm) — 가입하면 바로 세션이 온다.
//   비밀번호 재설정 메일은 SMTP가 없어 아직 없다 — 화면에는 지원 이메일로 알려 달라는 안내만 둔다.
// 전화번호 로그인은 없다. 화면은 이 파일의 함수만 쓴다. 브라우저·토큰 교환 세부는 여기 숨긴다.
//
// 카카오 흐름 — 직접 연동 + 세션 다리 (2026-10-09):
//   앱 → kauth.kakao.com/oauth/authorize (scope=profile_nickname, state=무작위)
//      → 카카오 로그인·동의
//      → https://modubokyak.vercel.app/kakao-callback.html?code=...&state=...   (중계 페이지)
//      → modubokyak://kakao-callback?code=...&state=...                          (앱 복귀)
//      → 엣지 함수 ?op=kakao-session 에 code 전달 → 서버가 카카오 회원을 확인하고 그 회원의
//        Supabase 계정 세션을 만들어 돌려준다 → supabase.auth.setSession 으로 이 기기에 앉힌다.
// 왜 Supabase의 카카오 로그인(signInWithOAuth)을 쓰지 않나: Supabase는 카카오에 account_email을 늘 함께 요청하는데,
//   그 항목은 비즈 앱이어야 켤 수 있어 지금 카카오 앱으로는 KOE205로 막힌다. 그래서 닉네임만 받는 직접 연동으로 간다
//   (자세한 이유·나중에 바꿀 때 주의점은 supabase/functions/ai/index.ts ?op=kakao-session 머리말).
// 카카오 클라이언트 시크릿은 서버(엣지 함수)에만 있다 — 앱에 넣으면 APK에서 꺼낼 수 있다.
// 카카오는 Redirect URI로 http/https만 받아 앱 스킴을 직접 못 쓴다 — 우리 도메인의 중계 페이지를 한 번 거친다.

const extra = Constants.expoConfig?.extra ?? {};
const FN = `${(extra.supabaseUrl as string) ?? ""}/functions/v1/ai`;
const ANON = (extra.supabaseAnonKey as string) ?? "";
// REST 키는 OAuth의 client_id 역할이라 공개돼도 되는 값이다(시크릿과 다르다).
const KAKAO_REST_KEY = (extra.kakaoRestKey as string) ?? "";
// 카카오 콘솔의 Redirect URI에 이 주소가 등록돼 있어야 한다(옛 빌드와 같은 주소).
const KAKAO_REDIRECT_URI = "https://modubokyak.vercel.app/kakao-callback.html";
// 중계 페이지가 앱으로 되돌려보내는 주소. app.json의 scheme과 맞아야 한다.
const KAKAO_RETURN_URL = "modubokyak://kakao-callback";
const SESSION_TIMEOUT_MS = 15000;

export type SignInResult = { ok: true } | { ok: false; canceled: boolean; message: string };
export type AppleSignInResult =
  | { ok: true; appleFullName: string | null }
  | { ok: false; canceled: boolean; message: string };

const NETWORK = "인터넷 연결을 확인하고 다시 시도해 주세요.";
const fail = (message: string) => ({ ok: false as const, canceled: false, message });
const canceled = () => ({ ok: false as const, canceled: true, message: "로그인을 취소했어요." });

export async function signInWithKakao(): Promise<SignInResult> {
  if (!isSupabaseConfigured || !KAKAO_REST_KEY) return fail("로그인 설정이 없어요.");
  try {
    const state = bytesToHex(Crypto.getRandomBytes(16));
    const url = kakaoAuthorizeUrl({ clientId: KAKAO_REST_KEY, redirectUri: KAKAO_REDIRECT_URI, state });
    const res = await WebBrowser.openAuthSessionAsync(url, KAKAO_RETURN_URL);
    if (res.type === "cancel" || res.type === "dismiss") return canceled();
    if (res.type !== "success" || !res.url) return fail("카카오 로그인 화면을 열지 못했어요.");

    const cb = parseAuthCallback(res.url);
    if (isUserCanceled(cb)) return canceled();
    if (cb.kind === "error") {
      console.warn("auth: 카카오 로그인 오류", cb.error, cb.message);
      return fail("카카오 로그인에 실패했어요. 다시 시도해 주세요.");
    }
    if (cb.kind !== "code") return fail("카카오에서 로그인 정보를 받지 못했어요.");
    // 이번에 연 창에서 돌아온 게 아니면 쓰지 않는다(다른 곳에서 끼워 넣은 code로 남의 계정에 로그인되는 일을 막는다).
    if (cb.state !== state) {
      console.warn("auth: 카카오 state 불일치");
      return fail("카카오 로그인에 실패했어요. 다시 시도해 주세요.");
    }

    // 인가 코드 → 서버가 카카오에 확인 → 그 회원의 Supabase 세션
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SESSION_TIMEOUT_MS);
    let r: Response;
    try {
      r = await fetch(`${FN}?op=kakao-session`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ANON}`, apikey: ANON, "Content-Type": "application/json" },
        body: JSON.stringify({ code: cb.code, redirect_uri: KAKAO_REDIRECT_URI }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const tokens = r.ok ? parseKakaoSession(await r.json().catch(() => null)) : null;
    if (!tokens) {
      console.warn("auth: 카카오 세션 받기 실패", r.status);
      return fail("로그인 정보를 확인하지 못했어요. " + NETWORK);
    }

    const { error } = await supabase.auth.setSession({ access_token: tokens.access_token, refresh_token: tokens.refresh_token });
    if (error) {
      console.warn("auth: 세션 저장 실패", error.message);
      return fail("로그인 정보를 확인하지 못했어요. " + NETWORK);
    }
    return { ok: true };
  } catch (e) {
    console.warn("auth: 카카오 로그인 예외", (e as Error)?.message ?? e);
    return fail("카카오 로그인 중 문제가 생겼어요. " + NETWORK);
  } finally {
    try { WebBrowser.maybeCompleteAuthSession(); } catch {}
  }
}

// Apple 로그인 (iOS 전용). nonce는 무작위 원문을 Supabase에, 그 SHA-256 해시를 Apple에 준다 —
// Supabase가 토큰 속 해시와 원문을 대조해 다른 곳에서 가로챈 토큰을 거른다.
// Apple은 이름을 처음 로그인할 때 한 번만 준다. 받은 이름은 돌려줘서 동의 화면 이름 칸을 채우고,
// 그 사이 앱이 꺼져도 남도록 계정 정보(user_metadata.full_name)에도 적어 둔다.
export async function signInWithApple(): Promise<AppleSignInResult> {
  if (Platform.OS !== "ios") return fail("이 휴대폰에서는 Apple 로그인을 쓸 수 없어요.");
  if (!isSupabaseConfigured) return fail("로그인 설정이 없어요.");
  try {
    if (!(await AppleAuthentication.isAvailableAsync())) return fail("이 휴대폰에서는 Apple 로그인을 쓸 수 없어요.");
    const rawNonce = bytesToHex(Crypto.getRandomBytes(32));
    const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
    const cred = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME],
      nonce: hashedNonce,
    });
    if (!cred.identityToken) return fail("Apple에서 로그인 정보를 받지 못했어요.");

    const { error } = await supabase.auth.signInWithIdToken({ provider: "apple", token: cred.identityToken, nonce: rawNonce });
    if (error) {
      console.warn("auth: Apple 토큰 로그인 실패", error.message);
      return fail("로그인 정보를 확인하지 못했어요. " + NETWORK);
    }
    const appleFullName = formatAppleFullName(cred.fullName) || null;
    if (appleFullName) {
      // 이름 저장 실패는 로그인 실패가 아니다 — 동의 화면에서 직접 적으면 된다.
      try { await supabase.auth.updateUser({ data: { full_name: appleFullName } }); } catch {}
    }
    return { ok: true, appleFullName };
  } catch (e) {
    if ((e as { code?: string })?.code === "ERR_REQUEST_CANCELED") return canceled();
    console.warn("auth: Apple 로그인 예외", (e as Error)?.message ?? e);
    return fail("Apple 로그인 중 문제가 생겼어요. 다시 시도해 주세요.");
  }
}

// ── 이메일·비밀번호 ───────────────────────────────────────────────────────────
// 화면 검사(validateEmailLogin)를 먼저 하고, 이메일은 다듬어(normalizeEmail) 보낸다.
// Supabase 오류는 삼키지 않고 한국어로 바꿔(emailAuthErrorMessage) 돌려준다 — 화면이 Alert로 보인다.
export async function signInWithEmail(email: string, password: string): Promise<SignInResult> {
  if (!isSupabaseConfigured) return fail("로그인 설정이 없어요.");
  const invalid = validateEmailLogin(email, password);
  if (invalid) return fail(invalid);
  try {
    const { error } = await supabase.auth.signInWithPassword({ email: normalizeEmail(email), password });
    if (error) {
      console.warn("auth: 이메일 로그인 실패", error.status, error.code, error.message);
      return fail(emailAuthErrorMessage(error, "login"));
    }
    return { ok: true };
  } catch (e) {
    console.warn("auth: 이메일 로그인 예외", (e as Error)?.message ?? e);
    return fail("로그인하지 못했어요. " + NETWORK);
  }
}

// 가입 — autoconfirm이라 세션이 바로 온다. 세션이 없으면(서버에서 확인 메일을 켠 경우) 가입은 됐으니
// 로그인으로 다시 들어오라고 안내한다(확인 메일은 보낼 수 없어 서버 설정을 봐야 하는 상태).
export async function signUpWithEmail(email: string, password: string): Promise<SignInResult> {
  if (!isSupabaseConfigured) return fail("로그인 설정이 없어요.");
  const invalid = validateEmailLogin(email, password);
  if (invalid) return fail(invalid);
  try {
    const { data, error } = await supabase.auth.signUp({ email: normalizeEmail(email), password });
    if (error) {
      console.warn("auth: 이메일 가입 실패", error.status, error.code, error.message);
      return fail(emailAuthErrorMessage(error, "signup"));
    }
    if (!data.session) {
      console.warn("auth: 이메일 가입은 됐지만 세션이 없다(확인 메일 설정?)");
      return fail("가입은 됐지만 로그인하지 못했어요. 「로그인」으로 다시 들어와 주세요.");
    }
    return { ok: true };
  } catch (e) {
    console.warn("auth: 이메일 가입 예외", (e as Error)?.message ?? e);
    return fail("가입하지 못했어요. " + NETWORK);
  }
}

// 이 기기의 로그인만 끝낸다(다른 기기의 로그인은 그대로).
// 인터넷이 없으면 서버 로그아웃이 실패하고 supabase-js가 세션을 기기에 남겨 둔다 —
// 그때는 기기에 저장된 세션을 직접 지워 "로그아웃했는데 로그인돼 있는" 일이 없게 한다.
export async function signOut(): Promise<void> {
  try {
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (!error) return;
    console.warn("auth: 서버 로그아웃 실패 — 기기 세션만 지운다", error.message);
  } catch {}
  await AsyncStorage.multiRemove([AUTH_STORAGE_KEY, `${AUTH_STORAGE_KEY}-code-verifier`, `${AUTH_STORAGE_KEY}-user`]).catch(() => {});
}

// 지금 로그인한 계정. 기기에 저장된 세션에서 읽는다(토큰이 만료됐으면 갱신을 시도한다).
export async function currentUser(): Promise<User | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.user ?? null;
  } catch {
    return null;
  }
}
