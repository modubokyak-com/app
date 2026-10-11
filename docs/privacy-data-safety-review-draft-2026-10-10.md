# 개인정보·건강 앱 제출 자료 검토 초안 — 2026-10-10

> **검토 초안이며 법률 확정문이나 Console 제출 답변이 아니다.** 코드와 저장소 SQL로 확인한 사실,
> 운영 환경에서 확인하지 못한 사항과 사용자 결정이 필요한 사항을 분리했다. 2026-10-10 승인된 전송 동의·
> 자동 저장·안전 로그아웃 UI는 앱 코드에 반영됐다. 2026-10-11 운영 DB 권한은 별도 검증됐지만,
> 공개 웹 문구·수탁사 설정·Play Console 답변은 아직 확정하지 않았다.

운영 법인/공개 문의 초안: **(주)안팜 / AhnPharm Inc. · official@modubokyak.com**

## 1. 최초 건강정보 전송 직전 고지·동의 UX 제안

> 구현 상태: 로그인 전 점검, 제품명 검색, 사진 OCR, 약 설명 조회를 실제 전송 범위별로 나누어 로컬 앱에
> 반영했다. 이는 전송 전 선택권을 구현한 것이며 개인정보 처리의 법적 적합성 전체를 보장하지 않는다.

현재 로그인 전 1분 점검도 `QuickCheckAnalyzingScreen`에서 약·영양제 이름, 연령대, 임신·수유/
신장질환/간질환 선택값을 Supabase `quick_check_v1` RPC로 보낸다. `PrivacyScreen`의 “로그인 전 점검은
서버에 저장하지 않는다”는 문구는 **DB 행으로 저장하지 않는다는 뜻일 뿐, 서버 전송이 없다는 뜻은 아니다.**
사진 추가를 선택하면 사진 base64도 Supabase Edge Function을 거쳐 OpenAI로 전송된다.

권장 흐름은 `결과 확인하기` 또는 사진의 `촬영/보관함 선택` 버튼을 누른 직후, 실제 네트워크 호출 전에
한 번만 별도 화면/바텀시트를 보여 주는 것이다.

### 권장 고지 문안 초안

**제목: 건강정보를 서버에서 확인할게요**

- 보내는 정보: 입력한 약·영양제 이름, 선택한 연령대와 건강 상태. 사진을 선택한 경우 약봉투/제품 사진.
- 받는 곳과 목적:
  - Supabase: 점검 요청 처리와 검수된 상호작용 결과 반환.
  - OpenAI: 사용자가 사진 인식 또는 서버에 없는 약 설명 기능을 선택한 경우 해당 입력 처리.
    일정 문장 해석용 helper/서버 endpoint도 저장소에 있지만 현재 앱 호출부는 확인되지 않았다.
- 로그인 전 점검 결과는 앱의 `quick_check_results` 계정 기록으로 저장하지 않지만, 네트워크 전송 자체는
  발생한다. 각 서비스 제공자의 요청 로그·보관 여부와 기간은 운영 계약/설정 확인 전 확정하지 않는다.
- 선택: **동의하고 확인하기** / **취소**. 취소하면 전송하지 않고 입력 화면으로 돌아간다.

민감정보 동의는 이용약관·일반 개인정보 동의와 분리된 체크/버튼으로 받고, 고지 버전과 동의 시각을
기록하는 안을 권장한다. 로그인 전 사용자는 계정이 없으므로 동의 증적을 어디에 얼마나 보관할지는
별도 결정이 필요하다. 단순히 “계속” 버튼만 두고 수신자·목적을 숨기는 안은 권장하지 않는다.

## 2. 코드로 확인한 전송·처리 흐름

| 출발 정보 | 직접 수신자 | 후속 수신자 | 목적 | 서버 DB 저장 확인 |
|---|---|---|---|---|
| 이름, 동의 항목/시각 | Supabase Auth/Postgres | 없음 확인 | 계정 및 환자 행 관리 | `patients`에 저장하는 코드 있음 |
| 카카오 인가 코드 | Supabase Edge Function | 카카오 OAuth/API | 카카오 회원번호·닉네임 확인, Supabase 세션 발급 | Auth 계정 생성 경로 있음. 카카오 실제 이메일은 요청하지 않고 가짜 내부 이메일 사용 |
| Apple identity token, 허용한 이름 | Supabase Auth | Apple | iOS 로그인 | Auth 저장 범위는 live 설정 확인 필요 |
| 약 이름·시각·요일·복용량 | Supabase Postgres | 없음 확인 | 일정/알람/약장 | `schedules` 저장 |
| 복용·미루기·건너뜀과 시각 | 로컬 outbox → Supabase Postgres | 없음 확인 | 복약 기록, 오프라인 재전송 | `intake_records` upsert |
| 알람 발생·응답·예정 시각 | Supabase Postgres | 없음 확인 | 알람 정확도/반응 분석 | `alarm_events` append 로그 |
| 1분 점검의 약·영양제·연령대·건강 상태 | Supabase RPC | 코드상 OpenAI로 전달하지 않음 | 검수 DB 규칙/DUR 대조 | 로그인 전 RPC 입력을 결과 테이블에 저장하는 코드는 없음. 로그인 후 결과 저장 가능 |
| 로그인 후 점검 입력/결과 | Supabase Postgres | 없음 확인 | 점검 이력 표시 | `quick_check_results` 저장 |
| 약봉투/제품 사진 base64 | Supabase Edge Function | OpenAI Chat Completions 비전 | 약 이름·복약 정보 OCR | 앱 서버 DB 저장 코드는 없음. 제공자 측 로그/보관은 미확인 |
| 복약 일정 자연어 문장 | Supabase Edge Function | OpenAI Chat Completions | 구조화 일정 해석 | `gptParseSchedule`/`?op=parse`는 존재하지만 현재 앱 호출부가 없어 활성 앱 전송으로 확인하지 않음 |
| 약 이름 | Supabase Edge Function | OpenAI Chat Completions | 서버에 없는 약의 짧은 설명 생성 | 응답/요청 저장 코드는 없음. 제공자 측 로그/보관은 미확인 |
| 음성 가이드 단계/버튼 폴백 수 | Supabase Postgres | 없음 확인 | 익명형 사용성 통계 | `voice_guide_events`; 환자 FK가 없어 계정 삭제 cascade 대상이 아님 |

코드 근거: `src/lib/ocr.ts`, `src/lib/openai.ts`, `src/lib/drugData.ts`,
`src/lib/quickCheckServer.ts`, `src/lib/quickCheckDraft.ts`, `src/lib/auth.ts`, `src/lib/records.ts`,
`src/lib/analytics.ts`, `supabase/functions/ai/index.ts`.

## 3. 보관·삭제: 확인된 사실과 미확인 사항

### 코드/저장소에서 확인됨

- `delete_my_account()` 초안은 현재 인증 사용자의 `patients` 행과 `auth.users` 행을 삭제한다.
- 저장소 스키마상 일정, 복약 기록, 알람 이벤트, 점검 결과는 환자 FK `on delete cascade`로 연결된다.
- 삭제 RPC 성공 뒤 앱은 예약 알람, 환자 id/이름, 점검 초안, 로컬 일정 사본, 미전송 outbox와 로컬
  인증 세션을 지운다.
- 약봉투 사진과 OpenAI 요청/응답을 앱의 Supabase 테이블에 저장하는 코드는 확인되지 않았다.
- 로그인 전 점검 초안은 약·영양제, 연령대, 건강 상태 및 분석 결과를 AsyncStorage에 저장한다.
- 다음 알람용 약 이름·시각·요일과 미전송 복약 기록도 AsyncStorage에 저장한다. 앱 자체 암호화는 없다.

### 2026-10-11 운영 DB에서 별도 검증됨

- 공개 범위가 넓던 정책 14개가 제거됐고, `patients`, `schedules`, `intake_records`, `alarm_events`,
  `quick_check_results`, `voice_guide_events`의 `anon` 권한이 회수됐다.
- 소유자 기준 정책 16개와 공개 참조 데이터의 조회/검색 범위만 남았다.
- 옛 `link_kakao` 경로는 차단됐고, 인증 사용자의 삭제 권한 및 계정 삭제 RPC, 일정-예정시각
  UNIQUE/FK 제약은 유지됐다.
- 이 검증은 권한·스키마 상태 확인이다. 실제 서비스 계정을 삭제해 백업까지 사라지는 과정을 시험한 것은 아니다.

### 아직 확인하지 못함 — 공개 문구에서 약속하면 안 됨

- Supabase, OpenAI, 카카오, Apple의 이 프로젝트 계약/리전/로그 설정, 처리 위치, 보관 기간, 백업 삭제 시점.
- Android/iOS OS 저장소 암호화와 백업 정책까지 포함해 로컬 데이터가 항상 암호화된다고 말할 근거.
- 네트워크 경로 전체가 Console 질문의 “모든 데이터 전송 중 암호화” 조건을 만족하는지. 코드 URL은
  HTTPS지만, 최종 답변 전 SDK·리디렉션·운영 설정을 함께 확인해야 한다.
- `voice_guide_events`는 환자 식별자가 없지만 계정 삭제 cascade 대상도 아니다. 현재 방침의 “앱 사용 기록
  즉시 모두 삭제”와 일치하지 않을 수 있으므로 익명 통계의 보관/삭제 정책을 결정해야 한다.
- 현재 웹 방침의 “즉시 삭제, 별도 보관 기간 없음, 복구 불가”는 운영 백업·수탁사 보관을 확인하기 전에는
  확정 표현으로 쓰지 않는다.

## 4. Google Play Data safety 입력 초안

Google은 기기 밖으로 전송되는 데이터를 `Collected`로 보며, 일시 처리도 신고 범위에 포함한다고 안내한다.
서비스 제공자가 개발자 지시에 따라 처리하는 경우 `Shared` 예외가 될 수 있지만, 실제 계약상 지위를
확인해야 한다. 참고: https://support.google.com/googleplay/android-developer/answer/10787469

| Google 데이터 유형 | 수집 초안 | 필수/선택 초안 | 목적 초안 | 비고/확인 필요 |
|---|---|---|---|---|
| Personal info → Name | 예 | 로그인 기능에는 필수 | App functionality, Account management | 직접 입력 이름·카카오 닉네임 |
| Personal info → User IDs | 예 | 로그인 기능에는 필수 | App functionality, Account management | Supabase/Kakao/Apple 식별자 |
| Personal info → Email address | **미정** | 미정 | Account management | Android 카카오는 실제 이메일을 요청하지 않음. Apple/Auth live 필드 확인 후 결정 |
| Health and fitness → Health info | 예 | 1분 점검·복약 기능 사용자가 제공 | App functionality | 약 이름, 일정, 복약 상태, 연령대·임신/질환 선택 포함 |
| Photos and videos → Photos | 예 | 사진 OCR을 선택한 사용자만 | App functionality | 일시 처리 여부와 OpenAI/Supabase 보관 설정 확인 필요 |
| App activity → App interactions | 예 | 알람/가이드 사용 시 자동 | Analytics, App functionality | `alarm_events`, `voice_guide_events` |
| Other user-generated content | 검토 | 직접 일정 문장을 자유 입력하는 경로 | App functionality | 같은 내용이 Health info로 충분한지 Console 실제 질문에서 확인 |
| Device or other IDs | 코드상 확인 안 됨 | — | — | SDK/플랫폼 자동 수집 여부 별도 확인 |
| Crash logs / Diagnostics | 코드상 수집 SDK 확인 안 됨 | — | — | EAS/Expo 운영 텔레메트리 설정 확인 필요 |

### 공유(Shared) 답변

- Supabase/OpenAI를 모두 수탁 서비스 제공자로 계약·통제하고 Google의 service-provider 정의를 충족하는지
  확인 전에는 “공유하지 않음”을 확정하지 않는다.
- 카카오/Apple 로그인은 사용자가 명시적으로 시작하지만, 해당 사업자의 독자적 처리 범위와 Google의
  user-initiated 예외 적용 여부를 확인한다.
- 광고/마케팅 SDK나 판매 경로는 `package.json`과 앱 코드에서 확인되지 않았다.

### 보안 관행 답변

- 삭제 요청 수단: 앱 내 삭제와 공개 URL은 코드/문서에 있으나 **live RPC와 공개 페이지 동작 확인 후 Yes**.
- 전송 중 암호화: 코드상 HTTPS 사용. **운영 전 경로 확인 후 Yes/No 결정**.
- 독립 보안 검토: 수행 증거가 없으므로 체크하지 않는다.

## 5. 건강 앱 신고 초안

- 주 기능: 복약 일정·알림, 복약 기록, 약/영양제 조합 점검.
- 최소 선택 후보: **Medication and Treatment Management**.
- 약물 상호작용 및 임신·신장·간질환 조건 점검에 대응하는 추가 Console 항목이 실제 설문에 있으면 함께
  선택한다. 화면을 확인하지 않은 상태에서 항목명을 추측해 제출하지 않는다.
- 의료기기/진단·처방 대체 기능이 아니라는 고지는 유지하되, 이것이 건강정보 신고를 면제하지는 않는다.
- 정확성 근거: quick check는 Supabase RPC의 검수 규칙/DUR 결과를 표시하며 실패 시 로컬 추측 결과를
  만들지 않는다. OpenAI 약 설명은 진단·용량 조정을 금지하고 의사·약사 확인 문구를 요구한다.

## 6. 심사자 접근 준비

저장·알람 기능은 Kakao 로그인이 필요하므로 기능을 숨기거나 심사 전용 인증 우회를 만들지 않는다.
Google은 제한 기능의 접근 지침을 App content → Sign-in details에 제공하도록 안내한다:
https://support.google.com/googleplay/android-developer/answer/9859455

사용자가 준비할 것:

1. 실제 이용약관에 맞게 만든 **전용 Kakao 심사 계정**. 타인의 개인 계정이나 임시 인증 우회 금지.
2. 심사 중 추가 본인확인·기기 승인·OTP가 발생하지 않도록 합법적으로 반복 로그인 가능한지 사전 기기 테스트.
3. Play Console 보안 입력란에만 계정 식별 정보와 단계별 영문 경로를 입력. 비밀번호·OTP를 저장소, PR,
   채팅, 스크린샷에 넣지 않는다.
4. 안내 경로 초안: 앱 시작 → Kakao 로그인 → 필수 동의/이름 입력 → 약 등록 → 알람 권한 → 저장 →
   알람/기록 확인. 로그인 없이 가능한 1분 점검 경로도 별도로 설명한다.

## 7. 최근 로컬 저장 수정의 한계 검토

- 계정 격리: outbox와 일정 사본은 `patientId` envelope로 격리한다. 첫 로그인/계정 전환 때 이전 로컬
  알람·사본·outbox를 제거하도록 2026-10-10 추가 보완했다.
- 로그아웃 손실: 오프라인 미전송 기록은 다른 계정으로 재전송되는 것을 막기 위해 로그아웃 때 삭제한다.
  따라서 사용자가 재연결 전에 로그아웃하면 해당 기록은 서버에 올라가지 않는다. 현재 UI는 이 손실을
  별도로 고지하지 않는다.
- 회원 삭제: 서버 삭제가 성공한 뒤 로컬 outbox를 제거하므로 삭제 후 재전송은 막는다. 운영 DB의 RPC와
  인증 사용자 실행 권한은 확인했지만 실제 서비스 계정 삭제·백업 삭제는 실행하지 않았다.
- 로컬 보안: 건강 관련 초안·약 이름·복약 상태가 앱 전용 AsyncStorage에 평문 JSON으로 저장되며 앱 자체
  암호화는 없다. OS/백업 보호를 확인하지 않은 상태에서 “암호화 저장”이라고 표시하지 않는다.
- 재부팅: 네이티브 receiver가 headless resync를 호출하고 저장된 세션+patientId가 있을 때 로컬 일정으로
  재예약한다. 제조사 절전, 강제 종료, 앱 업데이트, 저장소 손상 상황은 실제 기기 미검증이다.
- 전송 멱등성: 최신 로컬 의도와 DB unique/upsert로 중복 행을 억제한다. 분석용 `alarm_events`는 append-only라
  재시도/중복 분석 이벤트까지 exactly-once로 보장하지 않는다.

## 8. 승인된 UX와 남은 운영 확인

1. **승인·로컬 구현:** 로그인 없는 1분 점검을 유지하고, 제품 검색·점검·OCR·약 설명의 실제 전송 직전에
   범위별 명시 동의를 받는다. 거절하면 전송하지 않고 입력 초안을 유지한다.
2. **승인·로컬 구현:** 미전송 복약 기록이 있을 때만 로그아웃 손실 경고를 표시한다. 기본 선택은 돌아가기이며,
   저장 완료 후 로그아웃과 명시적 기록 삭제 후 로그아웃을 분리한다.
3. **운영 확인 필요:** 구체 보관 기간, 백업/수탁사 삭제 시점, 국외 처리·이전 문구를 실제 계약과 설정으로
   확인하고 개인정보처리방침·Data Safety·앱 고지를 일치시켜야 한다.
