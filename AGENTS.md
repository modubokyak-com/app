# AGENTS.md — 케어(CARE) 프로젝트 규칙

고령층을 위한 복약 관리 MVP (안내는 음성, 입력은 화면 터치). 구현자(Claude 서브에이전트)와
교차 리뷰어(OpenAI Codex)가 **공유**하는 규칙. 어기면 리뷰에서 막힌다.

## 무엇을 만드는가

- **앱:** React Native + Expo (managed), TypeScript. 코드는 `care-app/`에 있다.
- **백엔드:** Supabase Postgres + **Supabase Auth 간편 로그인**(안드로이드 카카오, iOS 카카오+Apple,
  회의 2026-10-08) + **이메일·비밀번호 로그인**(2026-10-15 추가: 스토어 심사 접근과 간편 로그인을 못 쓰는
  사람용. 가입 확인 메일 없음(autoconfirm), 비밀번호 재설정 메일은 SMTP가 없어 아직 없음 — 화면은
  `EmailLoginScreen`, 입력 검사·오류 문구는 `lib/authHelpers.ts`). 전화번호 로그인은 없다.
  1분 점검은 로그인 없이 되고, 결과 저장·알람부터 로그인한다(처음이면 동의 화면). 로그인 계정 하나에 환자 행 하나(`patients.user_id`).
  로그인은 `lib/auth.ts`, 내 환자·로그아웃·계정 삭제는 `lib/account.ts`에 가둔다.
  **카카오는 Supabase의 카카오 로그인(provider kakao)을 쓰지 않는다** — 그 기능은 `account_email`을
  늘 요청하는데 우리 카카오 앱은 비즈 앱이 아니라 KOE205로 막힌다(2026-10-09, 카카오 콘솔·Supabase 설정은
  지금 바꾸지 않기로 함). 앱은 `profile_nickname`만 요청하는 직접 연동으로 인가 코드를 받고, 엣지 함수
  `?op=kakao-session`이 그 코드를 확인해 Supabase 계정(가짜 이메일 `kakao-<회원번호>@kakao.modubokyak.com`,
  메일은 보내지 않음, `app_metadata.login = "kakao"`)과 세션을 만들어 준다. 옛 빌드용 `?op=kakao-login`은 그대로 둔다.
  Apple은 Supabase `signInWithIdToken`을 그대로 쓴다.
  쓰는 사람은 본인(환자) 한 종류다.
  **보호자 기능은 없다** — 6자리 `patient_code`로 보호자가 읽기 전용 열람하는
  기능은 회의 결정으로 제거됐다. 되살리자는 제안을 하지 말 것. 코드에도 흔적이
  없어야 한다(`patient_code`, 역할 구분, 코드 입력 화면).
- **음성:** **앱은 문장을 읽어 주지 않고(TTS 없음), 음성 인식(STT)도 없다.**
  안내는 화면 글자와 알람 소리로 하고, 사용자는 화면 버튼으로 답한다 (복약 확인 화면도 2026-10-03부터 글자만). 회의 결정으로 음성 AI를 전부
  제거했다 — AI 건강전화(Realtime + WebRTC), 음성으로 약 등록, 온보딩 음성 응답.
  되살리자는 제안을 하지 말 것. 코드에 마이크·녹음·음성 인식 흔적이 없어야 한다
  (`RECORD_AUDIO`, `NSMicrophoneUsageDescription`, `expo-speech-recognition`,
  `react-native-webrtc`, `?op=realtime-token`).
  앱이 내는 소리는 알람 소리 mp3(`lib/alarmRinger.ts`, `assets/sounds`) 하나뿐이다.
  문장을 읽어 주는 곳은 더 없다 — 클라이언트 TTS(`lib/tts.ts`, `?op=tts` 호출부,
  `ttsCache`/`ttsSpeed`/`voiceSettings`)와 "음성 안내 속도" 설정(`VoiceSpeedScreen`)은
  2026-10-03에 지웠다. 엣지 함수의 `?op=tts`는 나중에 쓸 수도 있어 서버에만 남겨 뒀고,
  앱에서는 부르지 않는다. (알람 설정 안내도 같은 날부터 글자만 — 녹음 멘트
  재생(`cuePlayer`)과 `assets/voice/V*.mp3`는 지웠다.)
- **알림:** `expo-notifications` 로컬 예약 알림.

설계 문서: `docs/superpowers/specs/2026-06-11-care-mvp-design.md`
실행 플랜: `docs/superpowers/plans/2026-06-11-care-mvp.md`

## 절대 어기면 안 되는 3가지 설계 결정

1. **repeat_days = 빈 배열 `[]` 은 "매일"** 을 뜻한다. GPT가 돌려주는 문자열
   `"매일"` 은 `normalizeRepeatDays()` 로 `[]` 가 되어야 한다. 요일 배열은
   정렬·중복제거된 `int[]`(0=일 … 6=토).
2. **intake_records 쓰기는 반드시 upsert**, `onConflict: "schedule_id,scheduled_for"`.
   알림 재발화/재탭으로 같은 (schedule, 시각)에 **중복 행이 생기면 안 된다.**
   스키마에 `unique (schedule_id, scheduled_for)` 존재.
3. **알람 화면·복약 확인의 응답은 화면 터치로만 받는다.** 음성 인식을 다시
   붙이지 말 것. (`intent.ts`의 의도 분류 우선순위 재알림 > 미복용 > 복용완료 >
   인식실패는 음성을 되살릴 때를 대비해 테스트와 함께 남겨 뒀을 뿐, 지금은
   화면에서 쓰이지 않는다.)

## 코드 컨벤션

- 소리는 좁은 교체 가능 인터페이스 뒤에 둔다(`lib/alarmRinger.ts`). TTS를 다시
  붙이게 되면 같은 식으로 `lib/` 모듈 하나에 가둘 것. 화면이 음성 SDK를 직접
  호출하지 말 것.
- **소리가 버튼을 막으면 안 된다.** 소리 재생·저장·재예약을 하나의 `await`로 묶어
  입력을 잠그지 말 것. 선택은 즉시 반영하고 나머지는 뒤에서 처리한다
  (QA 2026-08-20에서 알림 소리 설정·음성 속도 설정이 이 문제로 지적됐다).
- 순수 로직(`intent.ts`, `schedule.ts`, `parse.ts`)은 RN/네트워크 의존이 없어야
  하고 jest로 단위 테스트한다. 화면·음성·알림은 실기기 수동 검증.
- 디자인 토큰은 `src/theme/tokens.ts`에서만 가져온다. 색·폰트 하드코딩 금지.
  고령층 대상: 본문 ≥18px, 주요 버튼 높이 ≥56px.
- 비동기 호출에 `await` 빠뜨리지 말 것. Supabase/`fetch` 에러는 삼키지 말고
  사용자에게 토스트/Alert로 노출하고 버튼 경로로 폴백.
- 모든 사용자 노출 문구는 한국어.

## 테스트 / 검증

```bash
cd care-app
npm test            # jest: intent / schedule / parse
npx tsc --noEmit    # 타입 체크
npm run check:server  # 네트워크 필요: 라이브 quick_check_v1(읽기 전용 RPC)에 앱 라벨·조건 별칭을 대조
```

`check:server`는 일부러 jest 밖에 둔 스크립트다(jest는 오프라인). 칩 라벨이 서버에서 제대로
풀리는지, `conditionAliases.ts`의 별칭이 실제 규칙에 걸리는지 확인하고 어긋나면 exit 1.
서버 데이터 공백(예: 유산균·알레르기약·여드름약)은 여기서 드러난다 — 앱에서 지어내지 말 것.

## 보안 한계 (의도적, MVP)

- API 키가 클라이언트(`app.json` extra)에 있다 — 데모용. 운영 시 서버 뒤로 이동.
- RLS는 두 단계다: `supabase/migrate-auth-1-additive.sql`(로그인 사용자 본인 행 정책 추가, 옛 빌드 유지)
  → 새 빌드 출시일에 `migrate-auth-2-lockdown.sql`(옛 anon 정책 제거). 2단계 전까지는 옛 anon 정책이
  열려 있으므로 앱은 `user_id`·`patient_id` 조건을 직접 건다.
이 한계는 알고 수용한 것이니 리뷰에서 "키를 노출했다"는 식의 지적은 불필요.
대신 **위 3개 설계 결정 위반·정확성 버그**에 집중하라.
