-- 앱 이용 통계 — 앱을 처음 연 때부터 로그인·가입·첫 알람 설정까지, 그리고 그 뒤 어느 화면을 여는지의 기록. (2026-10-29)
--
-- 보려는 것: 설치 → 인트로 시작 화면 → 1분 점검 단계 → 결과 → 로그인 → 동의(가입) → 첫 알람 설정의 퍼널.
-- 지금까지 앱은 로그인 전에 아무것도 남기지 않아 설치한 사람이 어디서 멈추는지 알 수 없었다.
-- 같은 휴대폰의 기록은 device_id 로 묶는다. 웹(web_events)과는 이어지지 않는다 — 웹에서 볼 수 있는 마지막 단계는 스토어 이동이다.
--
-- 쓰는 곳: 앱 src/lib/appStats.ts. 로그인 전에는 anon, 로그인 뒤에는 authenticated 로 insert 만 한다.
-- 남기는 것:
--   device_id   설치 번호 — 앱이 처음 열릴 때 만드는 무작위 값. 앱 저장소(AsyncStorage)에만 있고 90일이 지나면 새로 만든다.
--               계정·이름·하드웨어 정보로 만든 값이 아니고, 계정과 잇지 않는다(patient_id 를 담지 않는다).
--   session_id  실행 번호 — 앱을 열 때마다, 30분 넘게 쉬었다가 다시 앞으로 오면 새로.
--   event       아래 check 제약의 목록 — 화면이 바뀐 것과 단계·버튼 몇 개뿐
--   screen      event = 'screen' 일 때 연 화면의 이름(코드의 화면 이름, 예: QuickCheckInput · Login · Home)
--   purpose     로그인을 하게 된 까닭 — save(점검 결과 저장) · skip(인트로 「지금은 건너뛰기」) · returning(이미 쓰던 계정)
--   method      로그인 방법 — kakao · apple · email
--   is_new      로그인 뒤 처음 쓰는 사람이라 동의(가입)로 갔는지
--   signed_in   그 기록을 남길 때 로그인돼 있었는지
--   platform    ios · android
--   app_version 앱 버전(app.json 의 version)
-- 남기지 않는 것: 약·영양제 이름, 연령대, 건강 상태, 점검 결과, 이름, 계정·환자 번호, 광고 식별자, 기기 모델, IP 주소.
--
-- 권한: anon·authenticated 는 위 컬럼으로 insert 만(읽기·고치기·지우기 불가, id·created_at 은 서버가 정한다).
--   migrate-auth-2-lockdown.sql 은 이 테이블을 건드리지 않는다 — 로그인 전 기록을 받으려면 잠근 뒤에도 anon insert 가 필요하다.
--   publishable 키로 누구나 행을 넣을 수 있다(web_events 등 다른 지표 테이블과 같은 한계). 값의 모양은 check 제약으로만 막는다.
-- 보관: purge_usage_stats() 가 매일 90일 지난 행을 지운다(아래에서 함수를 다시 만든다). 개인정보처리방침 제4조.
-- 끄기: 앱 「더보기 → 개인정보 설정 → 앱 이용 통계 보내기」. 끄면 앱이 아무것도 보내지 않고 설치 번호도 지운다.
-- 시작: 이 테이블은 앱 새 빌드가 나가기 전에 만들어 두어도 된다(옛 빌드는 보내지 않는다). 웹 방침 제2조 8항 시행과 함께.
--   통계가 들어간 빌드를 처음 여는 휴대폰은 모두 first_open 을 보낸다 — 그 전부터 앱을 쓰던 시험 사용자도 새 설치로 잡힌다.
--
-- 적용: migrate-web-events.sql 다음에, Supabase SQL Editor 에 그대로 붙여 넣는다. 두 번 실행해도 안전.
-- 확인: 맨 아래 주석. 조회는 app-events-funnel.sql.

begin;

create table if not exists public.app_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  device_id uuid not null,
  session_id uuid not null,
  event text not null check (event in (
    'first_open',           -- 이 설치에서 처음 열었다
    'app_open',             -- 앱을 열었다(새 실행 번호)
    'screen',               -- 화면을 열었다(screen 칸)
    'intro_cta',            -- 인트로 마지막 장(1분 점검 · 건너뛰기 · 로그인)을 봤다
    'check_supp',           -- 1분 점검 1/3 영양제
    'check_rx',             -- 2/3 복용약
    'check_profile',        -- 3/3 기본 정보(연령대)
    'check_report',         -- 점검을 마치고 결과 화면으로 갔다
    'check_failed',         -- 인터넷·저장 문제로 점검하지 못했다
    'login_tap',            -- 로그인 버튼을 눌렀다(method · purpose)
    'login_done',           -- 로그인에 성공했다(is_new = 동의 화면으로 감)
    'signup_done',          -- 동의까지 마쳐 가입했다
    'alarm_set',            -- 알람 설정 안내를 마쳤다
    'alarm_skip'            -- 알람 설정 안내를 건너뛰었다
  )),
  screen text check (screen ~ '^[A-Za-z]{1,40}$'),
  purpose text check (purpose in ('save', 'skip', 'returning')),
  method text check (method in ('kakao', 'apple', 'email')),
  is_new boolean,
  signed_in boolean not null,
  platform text not null check (platform in ('ios', 'android')),
  app_version text check (app_version ~ '^[0-9A-Za-z.+-]{1,20}$')
);
create index if not exists app_events_time_idx on public.app_events (created_at);
create index if not exists app_events_device_idx on public.app_events (device_id, created_at);

alter table public.app_events enable row level security;

-- Supabase 는 public 의 새 테이블에 anon·authenticated 전체 권한을 기본으로 준다 — 걷어 내고 insert 컬럼만 연다.
revoke all on public.app_events from anon, authenticated;
grant insert (device_id, session_id, event, screen, purpose, method, is_new, signed_in, platform, app_version)
  on public.app_events to anon, authenticated;

drop policy if exists app_events_insert on public.app_events;
create policy app_events_insert on public.app_events for insert to anon, authenticated with check (true);

-- ── 90일 자동 삭제에 app_events 를 더한다 (migrate-web-events.sql 의 함수를 바꿔 끼움) ──
-- 돌려주는 열이 하나 늘어 create or replace 로는 바꿀 수 없다 → 지우고 다시 만든다(같은 트랜잭션이라 빈틈 없음).
-- cron 작업 'purge-usage-stats' 는 함수 이름으로 부르므로 그대로 둔다.
drop function if exists public.purge_usage_stats(int);

create function public.purge_usage_stats(p_keep_days int default 90)
returns table (alarm_events_deleted bigint, voice_guide_events_deleted bigint, web_events_deleted bigint, app_events_deleted bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff timestamptz := now() - make_interval(days => p_keep_days);
  v_alarm bigint;
  v_voice bigint;
  v_web bigint;
  v_app bigint;
begin
  delete from public.alarm_events where event_at < v_cutoff;
  get diagnostics v_alarm = row_count;
  delete from public.voice_guide_events where created_at < v_cutoff;
  get diagnostics v_voice = row_count;
  delete from public.web_events where created_at < v_cutoff;
  get diagnostics v_web = row_count;
  delete from public.app_events where created_at < v_cutoff;
  get diagnostics v_app = row_count;
  return query select v_alarm, v_voice, v_web, v_app;
end;
$$;

revoke all on function public.purge_usage_stats(int) from public, anon, authenticated;

-- ── 대시보드용 집계 뷰 — stats 스키마(API 로 노출되지 않는다, migrate-web-events.sql 이 만들었다) ──
-- 한 줄 = 한 설치(device_id)의 하루(한국 시각). 그날 어느 단계까지 갔는지를 참/거짓으로 담는다.
-- 대시보드 도구에서 단계마다 「기간 안 서로 다른 device_id 수」를 세면 단계별 도달 수가 된다. 하루 단위 행이라
-- 여러 날에 걸친 설치는 날마다 나뉜다 — 기간 전체 퍼널은 app-events-funnel.sql 1번이 정확하다. 원본처럼 90일치다.
-- 읽기 전용 계정은 migrate-web-events.sql 주석대로 만든다. 그 계정을 이 뷰보다 먼저 만들었다면
-- 「grant select on all tables」가 이 뷰를 포함하지 않으므로 한 번 더 준다: grant select on stats.app_device_days to stats_reader;
create schema if not exists stats;
revoke all on schema stats from public, anon, authenticated;

create or replace view stats.app_device_days as
select
  (e.created_at at time zone 'Asia/Seoul')::date                         as day,
  e.device_id,
  (array_agg(e.platform order by e.created_at))[1]                       as platform,
  (array_agg(e.app_version order by e.created_at desc)
     filter (where e.app_version is not null))[1]                        as app_version,
  count(distinct e.session_id)                                           as sessions,
  bool_or(e.event = 'first_open')                                        as first_open,
  bool_or(e.event = 'intro_cta')                                         as intro_cta,
  bool_or(e.event = 'check_supp')                                        as check_start,
  bool_or(e.event = 'check_report')                                      as check_report,
  bool_or(e.event = 'check_failed')                                      as check_failed,
  bool_or(e.event = 'login_tap')                                         as login_tap,
  bool_or(e.event = 'login_done')                                        as login_done,
  bool_or(e.event = 'signup_done')                                       as signup_done,
  bool_or(e.event = 'alarm_set')                                         as alarm_set,
  bool_or(e.event = 'alarm_skip')                                        as alarm_skip,
  bool_or(e.signed_in)                                                   as signed_in
from public.app_events e
group by 1, 2;

revoke all on stats.app_device_days from public, anon, authenticated;

commit;

-- 확인
-- 1) anon·authenticated 는 insert 만:
--    select grantee, privilege_type, column_name from information_schema.column_privileges
--     where table_schema = 'public' and table_name = 'app_events' and grantee in ('anon', 'authenticated');
-- 2) 정리 작업이 살아 있다:  select jobname, schedule, active from cron.job where jobname = 'purge-usage-stats';
-- 3) 지금 지울 것이 있는지(지우지 않고 세기만):
--    select count(*) from public.app_events where created_at < now() - interval '90 days';
-- 퍼널 조회는 app-events-funnel.sql.
