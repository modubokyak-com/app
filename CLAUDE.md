# CLAUDE.md

프로젝트 공유 규칙은 아래 파일을 따른다 (Codex와 동일한 규칙):

@AGENTS.md

## Claude 전용 메모

- 실행 방식은 `harness/HARNESS.md`를 따른다: 태스크마다 구현자 서브에이전트 →
  Claude 스펙 리뷰 → Claude 품질 리뷰 → **Codex 교차 리뷰**(`harness/codex-review.sh`).
- 서브에이전트에게는 플랜 파일을 읽게 하지 말고 태스크 전문을 붙여서 전달한다.
- 기존 `src/`(Vite 웹 프로토타입)는 **시각 레퍼런스**다. 수정하지 말 것.
  새 코드는 전부 `care-app/`에 작성한다.
- 기준 브랜치는 `main` 하나다(2026-10-19 브랜치 정리). 작업은 `main`에서 딴 짧은 기능 브랜치로 하고 끝나면 `main`에 합친다. 옛 `feat/care-mvp`는 지웠다.
