// 로그인 보조 — 순수 로직 (RN/네트워크 의존 없음, jest 대상).
// 브라우저·Supabase 호출은 auth.ts에 있고, 여기에는 그 사이에서 값을 읽고 고르는 일만 둔다.

// ── 카카오 로그인 창 열기 ───────────────────────────────────────────────────
// 닉네임(profile_nickname)만 요청한다. account_email을 넣으면 비즈 앱이 아닌 지금 카카오 앱은 KOE205로 막힌다
// (그래서 Supabase의 카카오 로그인을 쓰지 않는다 — auth.ts 머리말).
// state: 돌아온 주소가 이번에 연 로그인 창의 것인지 확인하는 무작위 값. 카카오가 그대로 돌려주고
// 중계 페이지(landing/kakao-callback.html)는 쿼리를 통째로 앱에 넘긴다.
export const KAKAO_SCOPE = "profile_nickname";

export function kakaoAuthorizeUrl(p: { clientId: string; redirectUri: string; state: string }): string {
  const q = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: "code",
    scope: KAKAO_SCOPE,
    state: p.state,
  });
  return `https://kauth.kakao.com/oauth/authorize?${q.toString()}`;
}

// ── 로그인 창에서 앱으로 돌아온 주소 읽기 ──────────────────────────────────
// 성공: modubokyak://kakao-callback?code=...&state=...
// 실패: modubokyak://kakao-callback?error=access_denied&error_description=...&state=...
// (# 뒤에 붙어 와도 읽는다.) state가 없으면 null — 맞는지는 auth.ts가 연 창의 값과 비교한다.
export type AuthCallback =
  | { kind: "code"; code: string; state: string | null }
  | { kind: "error"; error: string; message: string }
  | { kind: "none" };

export function parseAuthCallback(url: string): AuthCallback {
  if (typeof url !== "string" || url === "") return { kind: "none" };
  // RN의 URL 파서가 커스텀 스킴에서 흔들려 쿼리 문자열을 직접 읽는다.
  const qs = url.split(/[?#]/).slice(1).join("&");
  if (!qs) return { kind: "none" };
  const params = new Map<string, string>();
  for (const pair of qs.split("&")) {
    if (!pair) continue;
    const i = pair.indexOf("=");
    const k = i < 0 ? pair : pair.slice(0, i);
    const v = i < 0 ? "" : pair.slice(i + 1);
    try {
      params.set(decodeURIComponent(k), decodeURIComponent(v.replace(/\+/g, " ")));
    } catch {
      params.set(k, v);
    }
  }
  const error = params.get("error") || params.get("error_code") || "";
  const description = params.get("error_description") || "";
  if (error || description) return { kind: "error", error: error || "unknown", message: description || error };
  const code = params.get("code");
  if (code) return { kind: "code", code, state: params.get("state") ?? null };
  return { kind: "none" };
}

// 카카오 동의 화면에서 사용자가 "취소"를 고른 것인지 — 이건 실패 안내 없이 조용히 넘긴다.
export function isUserCanceled(cb: AuthCallback): boolean {
  return cb.kind === "error" && cb.error === "access_denied";
}

// ── 엣지 함수 ?op=kakao-session 응답 ────────────────────────────────────────
// 서버가 카카오 회원을 확인하고 만들어 준 Supabase 세션. 모양이 어긋나면 null — 로그인 실패로 안내한다.
export type KakaoSessionTokens = { access_token: string; refresh_token: string; nickname: string | null };

export function parseKakaoSession(body: unknown): KakaoSessionTokens | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.access_token !== "string" || !b.access_token) return null;
  if (typeof b.refresh_token !== "string" || !b.refresh_token) return null;
  const nick = typeof b.nickname === "string" && b.nickname.trim() ? b.nickname.trim() : null;
  return { access_token: b.access_token, refresh_token: b.refresh_token, nickname: nick };
}

// ── 로그인 계정에서 이름·로그인 수단 읽기 ───────────────────────────────────
// supabase-js의 User를 그대로 받되, 여기서 쓰는 칸만 적어 순수 로직으로 남긴다.
export type AuthUserLike = {
  app_metadata?: { provider?: unknown; providers?: unknown; login?: unknown } | null;
  user_metadata?: Record<string, unknown> | null;
};

export type LoginProvider = "kakao" | "apple" | "email";

// 카카오 계정은 서버(?op=kakao-session)가 만들어 app_metadata.login = "kakao"로 표시한다. Supabase는 이 계정의
// provider를 "email"로 적으므로 표시를 먼저 본다(app_metadata는 서버 키로만 쓸 수 있어 사용자가 꾸밀 수 없다).
// Apple은 Supabase가 provider "apple"로 적는다.
// 이메일·비밀번호로 직접 가입한 계정(2026-10-15)은 provider "email"이고 login 표시가 없다 — 그때만 "email".
export function loginProviderOf(user: AuthUserLike | null | undefined): LoginProvider | null {
  const meta = user?.app_metadata;
  if (meta?.login === "kakao") return "kakao";
  const p = meta?.provider;
  return p === "kakao" || p === "apple" || p === "email" ? p : null;
}

export function loginProviderLabel(user: AuthUserLike | null | undefined): string | null {
  const p = loginProviderOf(user);
  return p === "kakao" ? "카카오" : p === "apple" ? "Apple" : p === "email" ? "이메일" : null;
}

// ── 이메일·비밀번호 로그인 (2026-10-15: 스토어 심사 접근 + 간편 로그인을 못 쓰는 사람용) ────────
// 입력 다듬기 — Supabase는 이메일을 소문자로 저장하므로 대소문자가 달라 두 계정이 되는 일을 막는다.
export function normalizeEmail(s: string): string {
  return (s ?? "").trim().toLowerCase();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PASSWORD_MIN = 6;
export const PASSWORD_TOO_SHORT = `비밀번호는 ${PASSWORD_MIN}자 이상이어야 해요.`;

// 서버에 보내기 전 화면에서 거르는 검사. 어긋나면 한국어 안내 문구, 괜찮으면 null.
export function validateEmailLogin(email: string, password: string): string | null {
  const e = normalizeEmail(email);
  if (!e) return "이메일을 입력해 주세요.";
  if (!EMAIL_RE.test(e)) return "이메일 주소 형식이 맞지 않아요.";
  if (!password) return "비밀번호를 입력해 주세요.";
  if (password.length < PASSWORD_MIN) return PASSWORD_TOO_SHORT;
  return null;
}

// Supabase Auth 오류 → 사용자 안내. 코드(code)가 있으면 그것을, 없으면(옛 supabase-js·게이트웨이 오류) 문구를 본다.
// 비밀번호 재설정 메일은 SMTP가 없어 아직 못 보낸다 — 잘못된 비밀번호 안내에 재설정 길을 적지 않는다.
export type AuthErrorLike = { message?: string; status?: number; code?: string } | null | undefined;

export function emailAuthErrorMessage(err: AuthErrorLike, mode: "login" | "signup"): string {
  const code = err?.code ?? "";
  const msg = err?.message ?? "";
  const status = err?.status;
  if (code === "invalid_credentials" || /invalid login credentials/i.test(msg)) return "이메일 또는 비밀번호가 맞지 않아요.";
  if (code === "user_already_exists" || code === "email_exists" || /already (been )?registered|already exists/i.test(msg)) {
    return "이미 가입된 이메일이에요. 로그인해 주세요.";
  }
  if (code === "weak_password" || (/password/i.test(msg) && /at least|short|weak/i.test(msg))) return PASSWORD_TOO_SHORT;
  if (code === "email_not_confirmed" || /not confirmed/i.test(msg)) return "이메일 확인이 아직 안 됐어요. 잠시 후 다시 시도해 주세요.";
  if (code === "signup_disabled" || code === "email_provider_disabled" || /signups? (are )?not allowed|(logins?|signups?) (is|are) disabled/i.test(msg)) {
    return "지금은 이메일 가입을 받지 않아요.";
  }
  if (status === 429 || code === "over_request_rate_limit" || code === "over_email_send_rate_limit" || /rate limit|too many/i.test(msg)) {
    return "시도가 너무 많아요. 잠시 후 다시 해 주세요.";
  }
  return mode === "login"
    ? "로그인하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요."
    : "가입하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.";
}

// 이름 칸 최대 길이 — 동의 화면 입력창(maxLength)과 같다.
export const NAME_MAX = 20;

// 계정 정보(user_metadata)에서 이름으로 쓸 칸. 카카오 닉네임은 서버(?op=kakao-session)가 name·nickname에,
// Apple 이름은 auth.ts가 full_name에 담는다. 나머지는 다른 로그인 수단이 쓰는 칸이다. 앞에서부터 처음 찾은 값을 쓴다.
const NAME_KEYS = ["name", "full_name", "nickname", "preferred_username", "user_name"] as const;

function clean(v: unknown): string {
  return typeof v === "string" ? v.trim().slice(0, NAME_MAX) : "";
}

// 동의 화면 이름 칸에 미리 채울 값. Apple은 이름을 처음 로그인할 때 한 번만 주므로
// 그 값이 있으면 먼저 쓴다. 아무것도 없으면 빈 문자열 — 사용자가 적는다.
export function displayNameFrom(user: AuthUserLike | null | undefined, appleFullName?: string | null): string {
  const apple = clean(appleFullName);
  if (apple) return apple;
  const meta = user?.user_metadata ?? {};
  for (const k of NAME_KEYS) {
    const v = clean(meta[k]);
    if (v) return v;
  }
  return "";
}

// Apple이 주는 이름 조각을 한 줄로. 한글 이름이면 성+이름을 붙여 쓰고(홍길동),
// 아니면 이름 성 순서로 띄어 쓴다(John Appleseed).
const HANGUL = /^[가-힣ㄱ-ㆎ]+$/;
export function formatAppleFullName(
  n: { givenName?: string | null; familyName?: string | null } | null | undefined,
): string {
  const given = (n?.givenName ?? "").trim();
  const family = (n?.familyName ?? "").trim();
  if (!given && !family) return "";
  if (HANGUL.test(given + family)) return `${family}${given}`;
  return [given, family].filter(Boolean).join(" ");
}

// Apple 로그인 nonce — 무작위 바이트를 16진수 문자열로.
export function bytesToHex(bytes: ArrayLike<number>): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += (bytes[i] & 0xff).toString(16).padStart(2, "0");
  return s;
}
