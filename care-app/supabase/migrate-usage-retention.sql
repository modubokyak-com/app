-- 앱 사용 기록(이용 통계) 90일 자동 삭제 — 개인정보처리방침 5항(보관과 파기)과 맞춘다. (결정 2026-10-15)
--
-- 대상(앱이 insert만 하고 읽지 않는 통계 로그, lib/analytics.ts):
--   · public.alarm_events        — 알람이 울린 시각·응답(계정에 연결, 계정 삭제 때는 cascade로 먼저 지워짐)
--   · public.voice_guide_events  — 알람 설정 완료 통계(식별값 없음, 계정과 연결되지 않아 계정 삭제로는 안 지워짐)
-- intake_records(복약 기록)·quick_check_results(점검 결과)는 사용자가 보는 데이터라 대상이 아니다.
--
-- 방식: pg_cron(Supabase 기본 제공)으로 매일 04:00 KST(19:00 UTC)에 purge_usage_stats()를 돌린다.
--   함수는 security definer — cron 작업은 postgres 권한으로 돌지만, 수동 점검용으로도 같은 함수를 쓴다.
--   두 번 실행해도 안전(cron.unschedule 뒤 다시 schedule).
-- 적용: Supabase SQL Editor 또는 Management API로 실행. 2026-10-15 운영 DB 적용 완료.
-- 확인: select jobname, schedule, active from cron.job;  select * from cron.job_run_details order by start_time desc limit 5;

create extension if not exists pg_cron;

create or replace function public.purge_usage_stats(p_keep_days int default 90)
returns table (alarm_events_deleted bigint, voice_guide_events_deleted bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff timestamptz := now() - make_interval(days => p_keep_days);
  v_alarm bigint;
  v_voice bigint;
begin
  delete from public.alarm_events where event_at < v_cutoff;
  get diagnostics v_alarm = row_count;
  delete from public.voice_guide_events where created_at < v_cutoff;
  get diagnostics v_voice = row_count;
  return query select v_alarm, v_voice;
end;
$$;

-- 앱 키(anon·authenticated)로는 부르지 못하게 — 통계 삭제는 서버 작업이다.
revoke all on function public.purge_usage_stats(int) from public, anon, authenticated;

-- 매일 04:00 KST. 이미 있으면 바꿔 끼운다.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'purge-usage-stats') then
    perform cron.unschedule('purge-usage-stats');
  end if;
  perform cron.schedule('purge-usage-stats', '0 19 * * *', $job$ select public.purge_usage_stats(90); $job$);
end
$$;
