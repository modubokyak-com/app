# landing/ — 옛 `modubokyak.vercel.app` (앱 카카오 로그인 중계 전용)

**회사 사이트·웹 1분 점검은 [`modubokyak-com/web`](https://github.com/modubokyak-com/web) 으로 옮겼습니다**(modubokyak.com, Vercel 팀 Modubokyak).

이 폴더는 옛 Vercel 프로젝트 `modubokyak.vercel.app`(개인 계정, git 연결 없이 수동 배포)에 남겨 둘 것만 담습니다.

| 파일 | 왜 남기나 |
|---|---|
| `kakao-callback.html` · `logo.png` | **앱 카카오 로그인 중계 — 지우지 마세요.** `care-app/src/lib/auth.ts` 의 `KAKAO_REDIRECT_URI` 가 `https://modubokyak.vercel.app/kakao-callback.html` 이다 |
| `vercel.json` | 옛 주소를 새 사이트로 넘긴다 — `/` → modubokyak.com, `/privacy.html` → modubokyak.com/privacy/, `/delete-account.html` → modubokyak.com/delete/ (Play Console 에 옛 주소가 등록돼 있었다) |

⚠ 옛 프로젝트에 이 폴더를 다시 올리는 것은 **`https://modubokyak.com` 이 열린 뒤에** 하세요. 그 전에 올리면 옛 방침·삭제 주소가 열리지 않는 주소로 넘어갑니다.

나중에 카카오 중계를 새 도메인(`https://modubokyak.com/kakao-callback.html`, web 저장소에 사본 있음)으로 옮기려면
카카오 개발자 콘솔 Redirect URI 등록 + `auth.ts` 의 `KAKAO_REDIRECT_URI` 변경 + 새 앱 빌드가 함께 필요합니다. 그 뒤엔 이 폴더와 옛 프로젝트를 지워도 됩니다.
