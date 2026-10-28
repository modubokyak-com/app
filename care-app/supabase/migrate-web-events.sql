-- 웹 이용 통계 — modubokyak.com(회사 사이트 · 웹 1분 점검 · 앱 받기)의 방문·단계 기록. (결정 2026-10-25)
--
-- 보려는 것: 사이트 방문 → 1분 점검 시작 → 단계별 진행 → 결과 → 앱 받기·스토어 이동까지의 퍼널.
-- 같은 사람이 여러 번 들어온 것은 visitor_id 로 묶는다(중복 접속 구분).
--
-- 쓰는 곳: web 저장소 stats.js (modubokyak-com/web). 로그인이 없는 웹이라 anon(publishable 키)으로 insert 만 한다.
-- 남기는 것:
--   visitor_id  브라우저 번호 — 처음 방문할 때 브라우저가 만든 무작위 값. 그 브라우저 저장소(localStorage)에만 있고
--               90일이 지나면 새로 만든다. 계정·이름·기기 정보와 이어지지 않는다.
--   visit_id    방문 번호 — 30분 넘게 아무 동작이 없거나 다른 경로(카카오 초대·약국 QR·다른 사이트)로 다시 들어오면 새로.
--   page        home(/) · check(/check/, /check/senior/) · app(/app/)
--   event       아래 check 제약의 목록 — 화면이 바뀐 것과 버튼 몇 개뿐
--   flow        1분 점검 단계가 본인 점검(self)인지 부모님 점검(parent)인지
--   entry       방문이 시작된 길 — direct · invite(카카오 초대 #invite=1) · pharmacy(약국 QR /check/senior/)
--   ref_host    다른 사이트에서 왔으면 그 사이트의 도메인만(예: search.naver.com). 주소 전체·검색어는 담지 않는다
-- 남기지 않는 것: 고른 약·영양제 이름, 연령대, 건강 상태, 점검 결과, IP 주소, 계정 번호.
--
-- 권한: anon 은 위 컬럼으로 insert 만(읽기·고치기·지우기 불가, id·created_at 은 서버가 정한다).
--   migrate-auth-2-lockdown.sql 은 이 테이블을 건드리지 않는다 — 웹에는 로그인이 없어 잠근 뒤에도 anon insert 가 필요하다.
--   publishable 키로 누구나 행을 넣을 수 있다(다른 지표 테이블과 같은 한계). 값의 모양은 check 제약으로만 막는다.
-- 보관: purge_usage_stats() 가 매일 90일 지난 행을 지운다(아래에서 함수를 다시 만든다). 개인정보처리방침 제4조.
-- 시작: 적용하는 즉시 받는다. 웹 방침(제2조 7항)은 2026-10-28 시행 — 출시 전·가입자 없음이라 사전 고지 없이 바로 시행(2026-10-25 결정).
--
-- 적용: Supabase SQL Editor 에 그대로 붙여 넣는다. 두 번 실행해도 안전.
-- 확인: 맨 아래 주석.

begin;

create table if not exists public.web_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  visitor_id uuid not null,
  visit_id uuid not null,
  page text not null check (page in ('home', 'check', 'app')),
  event text not null check (event in (
    'view',                 -- 페이지를 열었다
    'check_supp',           -- 1분 점검 1단계(영양제) 화면
    'check_rx',             -- 2단계(복용약·연령대) 화면
    'check_analyzing',      -- 점검을 눌러 서버 판정을 시작했다
    'check_report',         -- 결과 화면
    'check_failed',         -- 서버에 닿지 못해 판정하지 못했다
    'parent_start',         -- 결과 아래 「부모님 약 점검하기」
    'share',                -- 「가족·지인에게 1분 점검 보내기」
    'store_android',        -- /app/ 에서 Google Play 로 이동
    'store_ios'             -- /app/ 에서 App Store 로 이동
  )),
  flow text check (flow in ('self', 'parent')),
  entry text not null check (entry in ('direct', 'invite', 'pharmacy')),
  ref_host text check (ref_host ~ '^[a-z0-9.-]{1,100}$')
);
create index if not exists web_events_time_idx on public.web_events (created_at);
create index if not exists web_events_visitor_idx on public.web_events (visitor_id, created_at);

alter table public.web_events enable row level security;

-- Supabase 는 public 의 새 테이블에 anon·authenticated 전체 권한을 기본으로 준다 — 걷어 내고 insert 컬럼만 연다.
revoke all on public.web_events from anon, authenticated;
grant insert (visitor_id, visit_id, page, event, flow, entry, ref_host) on public.web_events to anon;

drop policy if exists web_events_insert on public.web_events;
create policy web_events_insert on public.web_events for insert to anon with check (true);

-- ── 90일 자동 삭제에 web_events 를 더한다 (migrate-usage-retention.sql 의 함수를 바꿔 끼움) ──
-- 돌려주는 열이 하나 늘어 create or replace 로는 바꿀 수 없다 → 지우고 다시 만든다(같은 트랜잭션이라 빈틈 없음).
-- cron 작업 'purge-usage-stats' 는 함수 이름으로 부르므로 그대로 둔다.
drop function if exists public.purge_usage_stats(int);

create function public.purge_usage_stats(p_keep_days int default 90)
returns table (alarm_events_deleted bigint, voice_guide_events_deleted bigint, web_events_deleted bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff timestamptz := now() - make_interval(days => p_keep_days);
  v_alarm bigint;
  v_voice bigint;
  v_web bigint;
begin
  delete from public.alarm_events where event_at < v_cutoff;
  get diagnostics v_alarm = row_count;
  delete from public.voice_guide_events where created_at < v_cutoff;
  get diagnostics v_voice = row_count;
  delete from public.web_events where created_at < v_cutoff;
  get diagnostics v_web = row_count;
  return query select v_alarm, v_voice, v_web;
end;
$$;

revoke all on function public.purge_usage_stats(int) from public, anon, authenticated;

-- ── 대시보드용 집계 뷰 — stats 스키마(API 로 노출되지 않는다) ─────────────────
-- 한 줄 = 한 사람(visitor_id)의 하루(한국 시각). 그날 어느 단계까지 갔는지를 참/거짓으로 담는다.
-- 대시보드 도구에서 단계마다 「기간 안 서로 다른 visitor_id 수」를 세면 단계별 도달 수가 된다
-- (예: COUNT_DISTINCT(CASE WHEN check_report THEN visitor_id END)). /app/ 은 홈에서 바로 갈 수도 있어서 도달 수는 퍼널이 아니다 —
-- 퍼널로 보려면 앞 단계 조건을 겹친다(check_start AND check_report …). 하루 단위 행이라 여러 날에 걸친 사람은
-- 날마다 나뉜다 — 기간 전체 퍼널은 web-events-funnel.sql 1번이 정확하다. 원본이 90일만 남으므로 이 뷰도 90일치다.
-- 점검 단계(check_*)는 본인 점검만 센다. 부모님 점검으로 들어간 것은 parent_start 로 따로 본다.
-- 대시보드에 읽기 전용 계정을 붙일 때는 이 스키마의 select 만 준다(원본 web_events 는 주지 않는다 — 뷰는 소유자 권한으로 읽는다):
--   create role stats_reader login password '<대시보드에서 정한 비밀번호>';   -- 저장소에 비밀번호를 적지 말 것
--   grant usage on schema stats to stats_reader;
--   grant select on all tables in schema stats to stats_reader;
create schema if not exists stats;
revoke all on schema stats from public, anon, authenticated;

create or replace view stats.web_visitor_days as
select
  (e.created_at at time zone 'Asia/Seoul')::date                                   as day,
  e.visitor_id,
  (array_agg(e.entry order by e.created_at))[1]                                     as first_entry,
  (array_agg(e.ref_host order by e.created_at) filter (where e.ref_host is not null))[1] as ref_host,
  count(distinct e.visit_id)                                                        as visits,
  bool_or(e.page = 'home'  and e.event = 'view')                                    as home_view,
  bool_or(e.page = 'check' and e.event = 'view')                                    as check_view,
  bool_or(e.event = 'check_supp'      and e.flow = 'self')                          as check_start,
  bool_or(e.event = 'check_rx'        and e.flow = 'self')                          as check_rx,
  bool_or(e.event = 'check_analyzing' and e.flow = 'self')                          as check_analyzing,
  bool_or(e.event = 'check_report'    and e.flow = 'self')                          as check_report,
  bool_or(e.event = 'check_failed')                                                 as check_failed,
  bool_or(e.event = 'parent_start')                                                 as parent_start,
  bool_or(e.event = 'share')                                                        as share,
  bool_or(e.page = 'app' and e.event = 'view')                                      as app_view,
  bool_or(e.event in ('store_android', 'store_ios'))                                as store
from public.web_events e
group by 1, 2;

revoke all on stats.web_visitor_days from public, anon, authenticated;

commit;

-- 확인
-- 1) anon 은 insert 만:
--    select grantee, privilege_type, column_name from information_schema.column_privileges
--     where table_schema = 'public' and table_name = 'web_events' and grantee in ('anon', 'authenticated');
-- 2) 정리 작업이 살아 있다:  select jobname, schedule, active from cron.job where jobname = 'purge-usage-stats';
-- 3) 지금 지울 것이 있는지(지우지 않고 세기만):
--    select count(*) from public.web_events where created_at < now() - interval '90 days';
-- 퍼널 조회는 web-events-funnel.sql.
