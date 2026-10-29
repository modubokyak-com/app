-- 웹 이용 통계 조회 — public.web_events (migrate-web-events.sql). 읽기 전용.
--
-- 어디서: Supabase 대시보드 → SQL Editor 에 붙여 넣고 Run. 「Save」로 저장해 두면 다음부터는 실행만 하면 된다.
--         web_events 는 anon 이 읽을 수 없다 — 웹페이지나 publishable 키로는 볼 수 없고 대시보드에서만 본다.
-- 기간:   기본은 오늘까지 최근 30일(한국 시각). 바꾸려면 각 조회 맨 위 params 를 예: date '2026-11-01' as d_from, date '2026-11-30' as d_to 로
--         (to 는 그날 포함). 기록은 90일만 남는다.
-- 사람 수: 「사람」= 서로 다른 visitor_id(브라우저 번호). 같은 사람이 여러 번 와도 한 번으로 센다.
--         브라우저를 바꾸거나 사이트 데이터를 지우면 다른 사람으로 센다. 추적 거부(DNT·GPC)·끄기를 누른 브라우저는 세지 않는다.
--         iPhone Safari 는 7일 넘게 들르지 않은 사이트의 저장소를 스스로 지운다 — 일주일 넘게 걸러 온 iPhone 사용자는 새 사람으로 잡힌다(4번 재방문이 적게 나온다).
-- 기록은 웹 배포와 migrate-web-events.sql 적용 뒤부터 쌓인다(방침 시행 2026-10-29).
--
-- 1) 단계별 퍼널 — 앞 단계를 모두 거쳐 각 단계까지 간 사람 수와, 첫 단계(사이트 방문)·앞 단계 대비 비율
-- 2) 들어온 길별 퍼널 — 바로 · 카카오 초대 · 약국 QR
-- 3) 날짜별 추이
-- 4) 재방문 — 며칠에 걸쳐 들어왔는지
-- 5) 어느 사이트에서 왔나

-- ── 1) 단계별 퍼널 ──────────────────────────────────────────────────────────
-- 각 단계 = 기간 안에 그 단계와 앞 단계를 모두 거친 사람 수(한 사람 안에서 시각 순서까지는 보지 않는다).
-- /app/ 은 홈에서 바로 갈 수도 있지만, 여기서는 「결과까지 본 사람 중」 앱 받기 페이지를 연 사람만 센다.
with params as (select (now() at time zone 'Asia/Seoul')::date - 29 as d_from, (now() at time zone 'Asia/Seoul')::date as d_to),
ev as (
  select e.* from public.web_events e, params p
  where e.created_at >= p.d_from::timestamp at time zone 'Asia/Seoul'
    and e.created_at <  (p.d_to + 1)::timestamp at time zone 'Asia/Seoul'
),
per as (
  select visitor_id,
         bool_or(page = 'check' and event = 'view')                   as s2,
         bool_or(event = 'check_supp'      and flow = 'self')         as s3,   -- 점검 단계는 본인 점검만(부모님 점검은 아래 참고)
         bool_or(event = 'check_rx'        and flow = 'self')         as s4,
         bool_or(event = 'check_analyzing' and flow = 'self')         as s5,
         bool_or(event = 'check_report'    and flow = 'self')         as s6,
         bool_or(page = 'app' and event = 'view')                     as s7,
         bool_or(event in ('store_android', 'store_ios'))             as s8
  from ev group by visitor_id
),
reached(ord, label, people) as (
  select 1, '사이트 방문(아무 페이지)',            count(*) from per union all
  select 2, '1분 점검 페이지 열기',                count(*) filter (where s2) from per union all
  select 3, '점검 시작(1단계 영양제)',             count(*) filter (where s2 and s3) from per union all
  select 4, '2단계(복용약·연령대)',                count(*) filter (where s2 and s3 and s4) from per union all
  select 5, '점검 누름',                           count(*) filter (where s2 and s3 and s4 and s5) from per union all
  select 6, '결과 봄',                             count(*) filter (where s2 and s3 and s4 and s5 and s6) from per union all
  select 7, '→ 앱 받기 페이지(/app/) 열기',        count(*) filter (where s2 and s3 and s4 and s5 and s6 and s7) from per union all
  select 8, '→ 스토어로 이동',                     count(*) filter (where s2 and s3 and s4 and s5 and s6 and s7 and s8) from per
)
select ord as "순서", label as "단계", people as "사람",
       round(100.0 * people / nullif(first_value(people) over (order by ord), 0), 1) as "방문 대비 %",
       round(100.0 * people / nullif(lag(people) over (order by ord), 0), 1) as "앞 단계 대비 %"
from reached order by ord;

-- 참고: 결과 화면의 버튼 — 결과를 본 사람 중 몇 명이 눌렀나
-- with params as (select (now() at time zone 'Asia/Seoul')::date - 29 as d_from, (now() at time zone 'Asia/Seoul')::date as d_to)
-- select event, count(distinct visitor_id) as "사람", count(*) as "횟수"
-- from public.web_events e, params p
-- where e.event in ('parent_start', 'share', 'check_failed')
--   and e.created_at >= p.d_from::timestamp at time zone 'Asia/Seoul'
--   and e.created_at <  (p.d_to + 1)::timestamp at time zone 'Asia/Seoul'
-- group by event;

-- ── 2) 들어온 길별 퍼널 ─────────────────────────────────────────────────────
-- entry 는 방문 단위다. 한 사람이 바로 왔다가 나중에 초대 링크로 오면 양쪽에 한 번씩 들어간다.
with params as (select (now() at time zone 'Asia/Seoul')::date - 29 as d_from, (now() at time zone 'Asia/Seoul')::date as d_to),
ev as (
  select e.* from public.web_events e, params p
  where e.created_at >= p.d_from::timestamp at time zone 'Asia/Seoul'
    and e.created_at <  (p.d_to + 1)::timestamp at time zone 'Asia/Seoul'
)
select case entry when 'direct' then '바로' when 'invite' then '카카오 초대' when 'pharmacy' then '약국 QR' end as "들어온 길",
       count(distinct visitor_id)                                                         as "방문한 사람",
       count(distinct visitor_id) filter (where event = 'check_supp' and flow = 'self')   as "점검 시작",
       count(distinct visitor_id) filter (where event = 'check_report' and flow = 'self') as "결과 봄",
       count(distinct visitor_id) filter (where page = 'app' and event = 'view')          as "앱 받기 페이지",
       round(100.0 * count(distinct visitor_id) filter (where event = 'check_report' and flow = 'self')
             / nullif(count(distinct visitor_id) filter (where event = 'check_supp' and flow = 'self'), 0), 1) as "시작→결과 %"
from ev group by entry order by 2 desc;

-- ── 3) 날짜별 추이 (한국 시각) ──────────────────────────────────────────────
with params as (select (now() at time zone 'Asia/Seoul')::date - 29 as d_from, (now() at time zone 'Asia/Seoul')::date as d_to)
select (e.created_at at time zone 'Asia/Seoul')::date as "날짜",
       count(distinct visitor_id)                                                         as "방문한 사람",
       count(distinct visit_id)                                                           as "방문 수",
       count(distinct visitor_id) filter (where event = 'check_supp' and flow = 'self')   as "점검 시작",
       count(distinct visitor_id) filter (where event = 'check_report' and flow = 'self') as "결과 봄",
       count(distinct visitor_id) filter (where page = 'app' and event = 'view')          as "앱 받기 페이지",
       count(distinct visitor_id) filter (where event in ('store_android', 'store_ios'))  as "스토어 이동"
from public.web_events e, params p
where e.created_at >= p.d_from::timestamp at time zone 'Asia/Seoul'
  and e.created_at <  (p.d_to + 1)::timestamp at time zone 'Asia/Seoul'
group by 1 order by 1;

-- ── 4) 재방문 — 한 사람이 며칠에 걸쳐 들어왔나 ──────────────────────────────
with params as (select (now() at time zone 'Asia/Seoul')::date - 29 as d_from, (now() at time zone 'Asia/Seoul')::date as d_to),
per_person as (
  select visitor_id,
         count(distinct (created_at at time zone 'Asia/Seoul')::date) as days,
         count(distinct visit_id) as visits
  from public.web_events e, params p
  where e.created_at >= p.d_from::timestamp at time zone 'Asia/Seoul'
    and e.created_at <  (p.d_to + 1)::timestamp at time zone 'Asia/Seoul'
  group by visitor_id
)
select case when days >= 4 then '4일 이상' else days || '일' end as "들어온 날 수",
       count(*) as "사람", sum(visits) as "방문 수"
from per_person group by 1 order by min(days);

-- ── 5) 어느 사이트에서 왔나 (방문 단위, 처음 들어온 페이지 기준) ─────────────
with params as (select (now() at time zone 'Asia/Seoul')::date - 29 as d_from, (now() at time zone 'Asia/Seoul')::date as d_to),
visits as (
  select visit_id, (array_agg(visitor_id))[1] as visitor_id, max(ref_host) as ref_host
  from public.web_events e, params p
  where e.created_at >= p.d_from::timestamp at time zone 'Asia/Seoul'
    and e.created_at <  (p.d_to + 1)::timestamp at time zone 'Asia/Seoul'
  group by visit_id
)
select coalesce(ref_host, '(없음 — 주소 직접 입력·앱 안 브라우저·북마크 등)') as "온 곳",
       count(*) as "방문 수", count(distinct visitor_id) as "사람"
from visits group by 1 order by 2 desc limit 30;
