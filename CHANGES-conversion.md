# 웹 이용 통계 — DB 쪽 메모 (병합 전에 지워도 됩니다)

브랜치 `claude/tender-newton-nzg92y`. 전체 설명은 `modubokyak-com/web` 같은 이름 브랜치의 `CHANGES-conversion.md`.

- **앱 코드는 바꾸지 않았습니다.** 앱 빌드·OTA 필요 없음. 바뀐 것은 SQL 과 문서뿐.
- `care-app/supabase/migrate-web-events.sql` — **Supabase SQL Editor 에서 웹 배포 전에 한 번 실행**(두 번 돌려도 안전).
  - `public.web_events`: anon 은 7개 컬럼 insert 만(읽기·수정·삭제·`id`/`created_at` 지정 불가). 계정과 이어지지 않는다.
  - `purge_usage_stats()` 를 `web_events` 까지 90일 지우는 판으로 바꿔 끼움(돌려주는 열 3개, cron `purge-usage-stats` 는 그대로).
  - `stats.web_visitor_days` 뷰 — 대시보드 도구용(API 로 노출되지 않는 `stats` 스키마, anon 접근 없음).
  - `migrate-auth-2-lockdown.sql` 은 이 테이블을 건드리지 않는다(웹에는 로그인이 없어 anon insert 가 계속 필요).
- `care-app/supabase/web-events-funnel.sql` — 읽기 전용 조회(기본 최근 30일): 단계별 퍼널, 들어온 길별, 날짜별, 재방문, 온 사이트.
- `migrate-usage-retention.sql` 에 "함수가 바뀌었다" 안내 한 줄, `docs/data-spec.md` 에 `web_events` 절.
- 확인: 적용 뒤 `select grantee, privilege_type, column_name from information_schema.column_privileges where table_name = 'web_events';`
  — anon 의 INSERT 7개만 나와야 한다. 로컬 Postgres 16 에서 두 번 적용·권한·삭제·조회를 확인했다.
