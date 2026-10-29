-- 앱 이용 통계 조회 — public.app_events (migrate-app-events.sql). 읽기 전용.
--
-- 어디서: Supabase 대시보드 → SQL Editor 에 붙여 넣고 Run. 「Save」로 저장해 두면 다음부터는 실행만 하면 된다.
--         app_events 는 앱(anon·authenticated)이 읽을 수 없다 — 대시보드에서만 본다.
-- 기간:   기본은 오늘까지 최근 30일(한국 시각). 바꾸려면 각 조회 맨 위 params 를 예: date '2026-11-01' as d_from, date '2026-11-30' as d_to 로
--         (to 는 그날 포함). 기록은 90일만 남는다.
-- 기기 수: 「기기」= 서로 다른 device_id(설치 번호). 앱을 지웠다 다시 깔거나 통계를 껐다 켜면 다른 기기로 센다.
--         설치 번호는 90일마다 새로 만든다. 「앱 이용 통계 보내기」를 끈 휴대폰은 세지 않는다.
-- 새 설치: 통계가 들어간 빌드를 처음 연 휴대폰(first_open). 그 전부터 쓰던 시험 사용자도 업데이트 뒤 처음 열 때 한 번 잡힌다.
-- 웹(web_events)과는 이어지지 않는다 — 웹 퍼널의 끝(스토어 이동)과 이 퍼널의 처음(새 설치)을 나란히 놓고 볼 뿐이다.
--
-- 1) 새 설치 퍼널 — 처음 열기 → 시작 화면 → 로그인 → 가입 → 첫 알람 설정
-- 2) 1분 점검 퍼널 — 시작 화면 → 점검 단계 → 결과 → 결과에서 로그인 → 가입
-- 3) 시작 화면에서 고른 길 — 1분 점검 · 지금은 건너뛰기 · 이미 계정이 있어요
-- 4) 로그인 방법별 — 누름 → 성공, 그중 처음 쓰는 사람
-- 5) 날짜별 추이
-- 6) 기기 종류·앱 버전별
-- 7) 화면별 — 로그인 전·후로 나눠
-- 8) 다시 연 비율 — 설치 다음 날 · 7일째

-- ── 1) 새 설치 퍼널 ─────────────────────────────────────────────────────────
-- 기간 안에 처음 연(first_open) 기기만 센다. 각 단계 = 그 단계와 앞 단계를 모두 거친 기기 수(시각 순서까지는 보지 않는다).
-- 시작 화면에서 1분 점검을 거치든 건너뛰든 로그인 단계로 모인다 — 점검을 거친 길은 2번에서 따로 본다.
with params as (select (now() at time zone 'Asia/Seoul')::date - 29 as d_from, (now() at time zone 'Asia/Seoul')::date as d_to),
ev as (
  select e.* from public.app_events e, params p
  where e.created_at >= p.d_from::timestamp at time zone 'Asia/Seoul'
    and e.created_at <  (p.d_to + 1)::timestamp at time zone 'Asia/Seoul'
),
per as (
  select device_id,
         bool_or(event = 'intro_cta')   as s2,
         bool_or(event = 'login_tap')   as s3,
         bool_or(event = 'login_done')  as s4,
         bool_or(event = 'signup_done') as s5,
         bool_or(event = 'alarm_set')   as s6
  from ev group by device_id
  having bool_or(event = 'first_open')
),
reached(ord, label, devices) as (
  select 1, '새 설치(처음 열기)',                    count(*) from per union all
  select 2, '시작 화면(1분 점검·건너뛰기·로그인)',   count(*) filter (where s2) from per union all
  select 3, '로그인 버튼 누름',                      count(*) filter (where s2 and s3) from per union all
  select 4, '로그인 성공',                           count(*) filter (where s2 and s3 and s4) from per union all
  select 5, '가입 완료(동의까지)',                   count(*) filter (where s2 and s3 and s4 and s5) from per union all
  select 6, '첫 알람 설정 마침',                     count(*) filter (where s2 and s3 and s4 and s5 and s6) from per
)
select ord as "순서", label as "단계", devices as "기기",
       round(100.0 * devices / nullif(first_value(devices) over (order by ord), 0), 1) as "설치 대비 %",
       round(100.0 * devices / nullif(lag(devices) over (order by ord), 0), 1) as "앞 단계 대비 %"
from reached order by ord;

-- ── 2) 1분 점검 퍼널 ────────────────────────────────────────────────────────
-- 기간 안에 시작 화면을 본 기기 기준(새 설치가 아니어도 — 로그아웃한 사람이 다시 점검하는 것도 든다).
-- 결과 화면의 로그인 버튼은 purpose = 'save'(점검 결과를 저장하려고 로그인)로 잡힌다.
with params as (select (now() at time zone 'Asia/Seoul')::date - 29 as d_from, (now() at time zone 'Asia/Seoul')::date as d_to),
ev as (
  select e.* from public.app_events e, params p
  where e.created_at >= p.d_from::timestamp at time zone 'Asia/Seoul'
    and e.created_at <  (p.d_to + 1)::timestamp at time zone 'Asia/Seoul'
),
per as (
  select device_id,
         bool_or(event = 'check_supp')                          as s2,
         bool_or(event = 'check_rx')                            as s3,
         bool_or(event = 'check_profile')                       as s4,
         bool_or(event = 'check_report')                        as s5,
         bool_or(event = 'login_tap'   and purpose = 'save')    as s6,
         bool_or(event = 'login_done'  and purpose = 'save')    as s7,
         bool_or(event = 'signup_done' and purpose = 'save')    as s8
  from ev group by device_id
  having bool_or(event = 'intro_cta')
),
reached(ord, label, devices) as (
  select 1, '시작 화면',                       count(*) from per union all
  select 2, '점검 1/3 영양제',                 count(*) filter (where s2) from per union all
  select 3, '점검 2/3 복용약',                 count(*) filter (where s2 and s3) from per union all
  select 4, '점검 3/3 기본 정보',              count(*) filter (where s2 and s3 and s4) from per union all
  select 5, '결과 봄',                         count(*) filter (where s2 and s3 and s4 and s5) from per union all
  select 6, '결과에서 로그인 누름',            count(*) filter (where s2 and s3 and s4 and s5 and s6) from per union all
  select 7, '로그인 성공',                     count(*) filter (where s2 and s3 and s4 and s5 and s6 and s7) from per union all
  select 8, '가입 완료(결과 저장)',            count(*) filter (where s2 and s3 and s4 and s5 and s6 and s7 and s8) from per
)
select ord as "순서", label as "단계", devices as "기기",
       round(100.0 * devices / nullif(first_value(devices) over (order by ord), 0), 1) as "시작 화면 대비 %",
       round(100.0 * devices / nullif(lag(devices) over (order by ord), 0), 1) as "앞 단계 대비 %"
from reached order by ord;

-- 참고: 점검하지 못한 기기(인터넷·저장 문제)
-- with params as (select (now() at time zone 'Asia/Seoul')::date - 29 as d_from, (now() at time zone 'Asia/Seoul')::date as d_to)
-- select count(distinct device_id) as "기기", count(*) as "횟수"
-- from public.app_events e, params p
-- where e.event = 'check_failed'
--   and e.created_at >= p.d_from::timestamp at time zone 'Asia/Seoul'
--   and e.created_at <  (p.d_to + 1)::timestamp at time zone 'Asia/Seoul';

-- ── 3) 시작 화면에서 고른 길 ────────────────────────────────────────────────
-- 시작 화면을 본 기기가 그 뒤 어디로 갔나. 「건너뛰기」·「이미 계정」은 로그인 화면이 열린 까닭(purpose)으로 가른다.
-- 한 기기가 여러 길을 가면 각각에 한 번씩 든다(합이 100%를 넘을 수 있다).
with params as (select (now() at time zone 'Asia/Seoul')::date - 29 as d_from, (now() at time zone 'Asia/Seoul')::date as d_to),
ev as (
  select e.* from public.app_events e, params p
  where e.created_at >= p.d_from::timestamp at time zone 'Asia/Seoul'
    and e.created_at <  (p.d_to + 1)::timestamp at time zone 'Asia/Seoul'
),
per as (
  select device_id,
         bool_or(event = 'check_supp')                                        as checked,
         bool_or(event = 'screen' and screen = 'Login' and purpose = 'skip')       as skipped,
         bool_or(event = 'screen' and screen = 'Login' and purpose = 'returning')  as has_account
  from ev group by device_id
  having bool_or(event = 'intro_cta')
)
select count(*)                                              as "시작 화면 본 기기",
       count(*) filter (where checked)                       as "1분 점검",
       count(*) filter (where skipped)                       as "지금은 건너뛰기",
       count(*) filter (where has_account)                   as "이미 계정 있음",
       count(*) filter (where not (checked or skipped or has_account)) as "아무것도 안 누름",
       round(100.0 * count(*) filter (where checked) / nullif(count(*), 0), 1) as "1분 점검 %"
from per;

-- ── 4) 로그인 방법별 ────────────────────────────────────────────────────────
-- purpose: save = 점검 결과 저장 · skip = 인트로 건너뛰기 · returning = 이미 쓰던 계정
with params as (select (now() at time zone 'Asia/Seoul')::date - 29 as d_from, (now() at time zone 'Asia/Seoul')::date as d_to),
ev as (
  select e.* from public.app_events e, params p
  where e.created_at >= p.d_from::timestamp at time zone 'Asia/Seoul'
    and e.created_at <  (p.d_to + 1)::timestamp at time zone 'Asia/Seoul'
)
select case method when 'kakao' then '카카오' when 'apple' then 'Apple' when 'email' then '이메일' end as "방법",
       case purpose when 'save' then '결과 저장' when 'skip' then '건너뛰기' when 'returning' then '이미 계정' end as "까닭",
       count(distinct device_id) filter (where event = 'login_tap')                  as "누른 기기",
       count(distinct device_id) filter (where event = 'login_done')                 as "성공한 기기",
       count(distinct device_id) filter (where event = 'login_done' and is_new)      as "그중 처음 쓰는 기기",
       round(100.0 * count(distinct device_id) filter (where event = 'login_done')
             / nullif(count(distinct device_id) filter (where event = 'login_tap'), 0), 1) as "성공 %"
from ev
where event in ('login_tap', 'login_done')
group by method, purpose
order by 3 desc;

-- ── 5) 날짜별 추이 (한국 시각) ──────────────────────────────────────────────
with params as (select (now() at time zone 'Asia/Seoul')::date - 29 as d_from, (now() at time zone 'Asia/Seoul')::date as d_to)
select (e.created_at at time zone 'Asia/Seoul')::date as "날짜",
       count(distinct device_id) filter (where event = 'first_open')   as "새 설치",
       count(distinct device_id)                                        as "앱을 쓴 기기",
       count(distinct session_id) filter (where event = 'app_open')    as "앱 열기",
       count(distinct device_id) filter (where event = 'check_report') as "점검 결과",
       count(distinct device_id) filter (where event = 'signup_done')  as "가입 완료",
       count(distinct device_id) filter (where event = 'alarm_set')    as "알람 설정 마침"
from public.app_events e, params p
where e.created_at >= p.d_from::timestamp at time zone 'Asia/Seoul'
  and e.created_at <  (p.d_to + 1)::timestamp at time zone 'Asia/Seoul'
group by 1 order by 1;

-- ── 6) 기기 종류·앱 버전별 ──────────────────────────────────────────────────
-- 새 설치 기기가 가입까지 갔는지. 버전은 처음 연 때의 값.
with params as (select (now() at time zone 'Asia/Seoul')::date - 29 as d_from, (now() at time zone 'Asia/Seoul')::date as d_to),
ev as (
  select e.* from public.app_events e, params p
  where e.created_at >= p.d_from::timestamp at time zone 'Asia/Seoul'
    and e.created_at <  (p.d_to + 1)::timestamp at time zone 'Asia/Seoul'
),
per as (
  select device_id,
         (array_agg(platform    order by created_at) filter (where event = 'first_open'))[1] as platform,
         (array_agg(app_version order by created_at) filter (where event = 'first_open'))[1] as app_version,
         bool_or(event = 'signup_done') as signed_up
  from ev group by device_id
  having bool_or(event = 'first_open')
)
select case platform when 'ios' then 'iPhone' else 'Android' end as "기기 종류",
       coalesce(app_version, '(모름)')                            as "앱 버전",
       count(*)                                                    as "새 설치",
       count(*) filter (where signed_up)                           as "가입 완료",
       round(100.0 * count(*) filter (where signed_up) / nullif(count(*), 0), 1) as "가입 %"
from per group by 1, 2 order by 1, 2;

-- ── 7) 화면별 — 로그인 전·후 ────────────────────────────────────────────────
-- 화면 이름은 코드의 화면 이름이다. Intro 인트로 · QuickCheckInput 점검 입력 · QuickCheckAnalyzing 분석 중 · QuickCheckResult 결과 ·
-- Login 로그인 · EmailLogin 이메일 로그인 · Consent 동의 · AlarmPrompt 알람 물음 · VoiceGuide 알람 설정 안내 ·
-- Home 홈 · Cabinet 내 약장 · Record 복약 기록 · More 더보기 · Privacy 개인정보 설정 …
with params as (select (now() at time zone 'Asia/Seoul')::date - 29 as d_from, (now() at time zone 'Asia/Seoul')::date as d_to)
select screen as "화면",
       count(distinct device_id) filter (where not signed_in) as "로그인 전 기기",
       count(distinct device_id) filter (where signed_in)     as "로그인 뒤 기기",
       count(*)                                                as "연 횟수"
from public.app_events e, params p
where e.event = 'screen'
  and e.created_at >= p.d_from::timestamp at time zone 'Asia/Seoul'
  and e.created_at <  (p.d_to + 1)::timestamp at time zone 'Asia/Seoul'
group by screen order by 4 desc;

-- ── 8) 다시 연 비율 — 설치 다음 날 · 7일째 ──────────────────────────────────
-- 기간 안에 처음 연 기기 중, 처음 연 날(한국 시각) 다음 날·7일째에 앱을 다시 연 비율.
-- 아직 그날이 오지 않은 기기는 대상에서 뺀다(오늘 설치한 기기는 다음 날 대상이 아니다).
with params as (select (now() at time zone 'Asia/Seoul')::date - 29 as d_from, (now() at time zone 'Asia/Seoul')::date as d_to),
installs as (
  select device_id, min((created_at at time zone 'Asia/Seoul')::date) as d0
  from public.app_events e, params p
  where e.event = 'first_open'
    and e.created_at >= p.d_from::timestamp at time zone 'Asia/Seoul'
    and e.created_at <  (p.d_to + 1)::timestamp at time zone 'Asia/Seoul'
  group by device_id
),
opens as (
  select distinct device_id, (created_at at time zone 'Asia/Seoul')::date as d
  from public.app_events where event = 'app_open'
),
today as (select (now() at time zone 'Asia/Seoul')::date as t)
select count(*)                                                                         as "새 설치",
       count(*) filter (where i.d0 + 1 <= t.t)                                          as "다음 날 대상",
       count(*) filter (where i.d0 + 1 <= t.t and exists (select 1 from opens o where o.device_id = i.device_id and o.d = i.d0 + 1)) as "다음 날 다시 염",
       round(100.0 * count(*) filter (where i.d0 + 1 <= t.t and exists (select 1 from opens o where o.device_id = i.device_id and o.d = i.d0 + 1))
             / nullif(count(*) filter (where i.d0 + 1 <= t.t), 0), 1)                  as "다음 날 %",
       count(*) filter (where i.d0 + 7 <= t.t)                                          as "7일째 대상",
       count(*) filter (where i.d0 + 7 <= t.t and exists (select 1 from opens o where o.device_id = i.device_id and o.d = i.d0 + 7)) as "7일째 다시 염",
       round(100.0 * count(*) filter (where i.d0 + 7 <= t.t and exists (select 1 from opens o where o.device_id = i.device_id and o.d = i.d0 + 7))
             / nullif(count(*) filter (where i.d0 + 7 <= t.t), 0), 1)                  as "7일째 %"
from installs i, today t;
