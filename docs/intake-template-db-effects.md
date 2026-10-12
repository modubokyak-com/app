# 입력 양식을 채우면 DB가 어떻게 바뀌나

> `docs/interaction-rule-intake-template.xlsx`(연구원용 조합 추가 입력 양식)의 시트·칸 하나하나가
> `interaction` 스키마의 어느 표에 어떤 행으로 들어가는지, 그리고 그 결과 앱이 어떻게 달라지는지.
> 2026-10-13 기준. 앞선 설명서 `docs/data-flow-for-researchers.md` 2장을 개발자 시점으로 자세히 푼 것.

---

## 0. 한 줄 요약

| 양식 시트 | DB에 생기는 변화 | 앱에 보이는 변화 |
|---|---|---|
| ① 새 조합 | 한 줄마다 **규칙 1행 + 항 2행 이상 + 출처 1~2행** 추가. 처음엔 `in_review / is_active=false` | 약사 승인 뒤부터 결과 카드 1장 추가 |
| ② 새 성분 | 한 줄마다 **성분 1행** 추가(+ 계열 소속 1행). 계열이 새것이면 계열 1행 + 계열 대표 성분 1행 | "점검하지 못한 항목"이던 이름이 바로 풀림(승인 불필요) |
| ③ 이미 있는 조합 (의견 칸) | 기존 규칙 행 **수정**(문장·등급) 또는 `review_status` 변경 | 승인된 문장이 바뀜 / 규칙이 내려감 |
| ④ 성분 목록 · ⑤ 용어 | **변화 없음** (참고용) | — |

`public` 스키마(사용자·일정·기록·식약처 자료)는 어느 시트를 채워도 **바뀌지 않습니다.**

---

## 1. 시트 ①「새 조합」 한 줄 → 표 세 개

예: `와파린 | 크랜베리 | (조건 없음) | 주의 | 제한적 | 요약… | 무슨 일이… | 어떻게 하면… | 출처: 부록 §4 p.358`

```
interaction_rule          +1행   규칙 본체 — 등급·근거·화면 문장·간격·중단 일수·검수 상태
interaction_rule_side     +2행   항: (rule_id, ordinal 1, substance #와파린, role object)
                                 (rule_id, ordinal 2, substance #크랜베리, role object)
evidence                  +1행   출처 (같은 citation+locator 가 이미 있으면 재사용, 0행)
rule_evidence             +1행   규칙 ↔ 출처 연결
```

### 1.1 칸별 대응

| 양식 ① 열 | 들어가는 곳 | 변환 | 비고 |
|---|---|---|---|
| A쪽 | `interaction_rule_side` 1행 | 이름 → 성분 `substance.id`(이름이 계열이면 `kind='drug_class_generic'`인 계열 대표 성분) | 시트 ④ 표기와 정확히 같아야 함. 못 찾으면 **그 줄 전체 보류** |
| B쪽 | `interaction_rule_side` 1행 | 같음 | |
| B쪽 "칼슘 / 철분" | `interaction_rule_side` **2행**, 둘 다 `role='either'` | `/`로 나눠 항을 늘림. A쪽은 `role='object'` | "둘 중 하나" 규칙. 사용자가 둘 중 하나만 골라도 걸림 |
| 조건 | `interaction_rule_side` 1행, `target_type='condition'` | 조건 이름 → `condition.id` | 조건 이름이 DB에 없으면 → 2.3 참고 |
| 등급 | `interaction_rule.severity` | 금기→contraindicated, 주의→caution, 시간 조정→timing, 확인 권장→monitor, 알아두기→info | DB CHECK로 다섯 값만 허용 |
| 근거 수준 | `interaction_rule.evidence_level` | 확립→established, 이론적→theoretical, 제한적→limited, 엇갈림→conflicting | |
| 요약 한 줄 | `interaction_rule.summary_ko` | 그대로 | |
| 무슨 일이 | `interaction_rule.what_happens_ko` | 그대로 | 앱이 그대로 보여 줌 |
| 어떻게 하면 | `interaction_rule.what_to_do_ko` | 그대로 | |
| 시간 간격(시간) | `interaction_rule.min_separation_hours` | 숫자 | 등급 timing일 때만 의미 |
| 수술 전 중단(일) | `interaction_rule.stop_days_before` | 숫자 | 조건 "수술 예정"과 함께 |
| 출처 | `evidence.citation` + `evidence.locator`, `rule_evidence(rule_id, evidence_id, relation)` | "임상건강기능식품학 부록 §4" / "p.358"처럼 나눠 넣음 | 근거가 엇갈리는 반대 출처는 `relation='contradicts'` |
| 기전 요약 | `interaction_rule`의 내부 메모 칸 | 그대로 | 화면에 안 나감 |
| 비고 | 변환 지시로만 사용 | — | DB에 넣지 않음 |
| 번호·작성자·날짜 | 변환 로그에만 남김 | — | DB에 넣지 않음 |

개발자가 채우는 칸(양식에 없음):

| DB 칸 | 값 | 뜻 |
|---|---|---|
| `interaction_rule.code` | 예 `warfarin_cranberry_inr` | 사람이 읽는 규칙 ID. 영문 소문자+밑줄 |
| `rule_kind` | `pair`(항 2개) / `set`(3개 이상) / `standalone`(조건 × 성분 하나) | 서버 함수는 이 셋만 읽음 |
| `relation_kind` | 기본 `interaction`; 고갈이면 `depletion`, 과다면 `limit` | depletion/limit 은 결과 화면에서 "중복·과다 확인" 묶음으로 감 |
| `review_status` | **`in_review`** | 들어갈 때의 값 |
| `is_active` | **`false`** | 들어갈 때의 값 |
| `interaction_rule_side.ordinal` | 1, 2, … | 항 순서 |

### 1.2 상태 변화 — 넣는 순간 앱이 바뀌지는 않는다

```
[적재]   review_status = 'in_review',  is_active = false   → 서버 함수가 읽지 않음, 화면 변화 0
   │  약사 검수 (문장·등급·출처 확인)
   ▼
[승인]   review_status = 'approved',   is_active = true    → 다음 점검부터 카드가 나옴
   또는
[반려]   review_status = 'rejected',   is_active = false   → 영구히 안 나감(행은 기록으로 남김)
```

`is_active=true`인데 `review_status<>'approved'`인 행은 DB CHECK 제약이 **거부**합니다. 승인 없이 게시되는 길은 없습니다. 앱 빌드를 다시 올릴 필요도 없습니다. 서버가 읽는 데이터만 바뀌므로 승인 즉시 모든 사용자에게 적용됩니다.

### 1.3 들어가기 전 개발자가 막는 것

| 검사 | 걸리면 |
|---|---|
| A·B 이름이 `substance.name_ko`/`aliases`에 없음 | 보류, 연구원에게 시트 ② 작성 요청 |
| 같은 항 조합의 규칙이 이미 있음(시트 ③ 70건과 대조) | 새 행 대신 **기존 행 수정 제안** |
| 등급·근거가 허용 값 밖 | 드롭다운을 쓰면 생기지 않음 |
| 출처 비어 있음 | 보류 |
| 화면 문장 비어 있음(요약·무슨 일이·어떻게 하면 모두) | 보류 |
| 조건 이름이 `condition`에 없음 | 2.3 절차로 조건 신설 후 적재 |

---

## 2. 시트 ②「새 성분」 한 줄 → 성분 사전

예: `베르베린 | berberine | 황련추출물, 바베린 | 생약·식물 | (계열 없음) | 아니오 | 출처…`

```
substance                 +1행   code='berberine', name_ko='베르베린', name_en='berberine',
                                 aliases={'황련추출물','바베린'}, kind=…
substance_class_member    +0~1행 "속하는 계열"이 있을 때
```

| 양식 ② 열 | DB 칸 | 변환 |
|---|---|---|
| 한글 이름 | `substance.name_ko` | 그대로. 시트 ①의 A·B쪽과 **글자가 같아야** 연결됨 |
| 영문 이름 | `substance.code`, `substance.name_en` | 소문자. 식약처 DUR 성분 코드와 같은 표기면(`metformin`처럼) `public.dur_product_ingredient`와 자동으로 이어져 **의약품 제품명 입력**도 풀림 |
| 다른 표기 | `substance.aliases` (문자열 배열) | 쉼표로 나눠 넣음. 서버는 `name_ko` 또는 `aliases` 중 하나라도 같으면 찾음 |
| 종류 | `substance.kind` | 약효군→`drug_class_generic`(계열 대표). 나머지는 기존 행이 쓰는 값 표기에 맞춰 개발자가 넣음 |
| 속하는 계열 | `substance_class_member(substance_id, class_id)` | 계열 이름 → `substance_class.id` |
| 앱 버튼으로 보이게? | (예일 때만) `intake_class` +1행, `intake_class_resolution` +1행 **+ 앱 코드 변경** | 2.2 참고 |
| 출처·비고 | `substance`의 메모 칸 | |

성분은 **검수 게이트가 없습니다.** 넣는 즉시 서버가 이름을 풀 수 있습니다. 다만 규칙에 연결되기 전까지는 "점검하지 못한 항목"에서 빠지는 것 외에 카드가 생기지는 않습니다.

### 2.1 "속하는 계열"이 DB에 없는 계열이면

```
substance_class             +1행   name_ko='SGLT2억제제'
substance (계열 대표)        +1행   kind='drug_class_generic', name_ko='SGLT2억제제'
substance_class.generic_substance_id  ← 위 대표 성분 id   (계열 다리. 이게 없으면 계열 규칙이 개별 약에 안 걸림)
substance_class_member      +N행   그 계열에 속하는 성분들
```

계열 대표 성분이 있어야 연구원이 "SGLT2억제제 × ○○"로 적은 규칙이 사용자가 "다파글리플로진"을 넣었을 때 걸립니다(2026-10-03에 이 다리가 빠져 아스피린·스타틴 규칙이 전혀 걸리지 않던 일이 있었음).

### 2.2 "앱 버튼으로 보이게 할까요?"에 예라고 하면 — DB만으로 끝나지 않음

| 바뀌는 곳 | 내용 |
|---|---|
| `intake_class` +1행 | 버튼 글자(`label_ko`), 쪽(`side` rx/supplement) |
| `intake_class_resolution` +1행 이상 | 버튼 → 성분 또는 계열 |
| **앱 코드** `care-app/src/lib/quickCheckLabels.ts` | 버튼 배열에 글자 추가 |
| **앱 코드** `care-app/src/lib/chipAliases.ts` | DB 이름이 버튼 글자와 다르면 별칭 |
| **앱 코드** `scripts/check-server-labels.mjs` | 새 버튼이 서버에서 풀리는지 검사에 포함 |
| **새 빌드** | 버튼은 앱 안에 있으므로 스토어 업데이트가 있어야 사용자에게 보임 |

그래서 버튼 추가는 "다음 빌드"로 묶어서 하고, 성분·규칙은 먼저 넣습니다.

### 2.3 시트 ①에 DB에 없는 조건을 적었으면 (간질환, 60대 이상 등)

```
condition                  +1행   code='liver_disease', name_ko='간질환'
interaction_rule_side      그 조건을 항으로 쓰는 규칙들
앱 코드 conditionAliases.ts  "간질환": ["간질환"]  ← 지금은 []  (서버에 보낼 조건 이름)
scripts/check-server-labels.mjs SENTINELS 에 살아 있는 증거 1건
```

조건 이름을 **앱 버튼 글자와 똑같이**(간질환) 만들면 앱 코드 변경 없이도 걸립니다(앱은 원래 라벨도 함께 보냄). 단 "신장질환"은 DB의 "만성콩팥병(3~4기·중증)"과 뜻이 달라, 연구원이 "모든 신장질환"에 적용할 규칙인지 "3~4기"에 한정인지 적어 주어야 매핑을 정합니다. 결과 화면의 "확인하지 못한 정보: 간질환" 표시는 앱의 `conditionAliases.ts`가 비어 있는 동안 계속 나오므로, 그 줄을 채운 빌드가 나가야 사라집니다.

---

## 3. 시트 ③「이미 있는 조합」의 의견 칸 → 기존 행 수정

| 의견 내용 | DB 변화 |
|---|---|
| 문장 고침 | `interaction_rule.what_happens_ko / what_to_do_ko / summary_ko` **update**. 이미 승인된 규칙이면 `review_status`를 `in_review`로 되돌려 재승인 받음(그동안 `is_active=false`로 내려감 → 카드가 잠시 사라짐) |
| 등급·근거 수준 변경 | `severity / evidence_level` update, 같은 재승인 절차 |
| 삭제 | 행을 지우지 않고 `review_status='rejected', is_active=false`. 항·출처 행은 그대로(기록 보존) |
| 출처 추가 | `evidence` +1행, `rule_evidence` +1행. 승인 상태 유지 |
| "둘 중 하나로 바꿔야" | `interaction_rule_side.role` update (`object` → `either`). 즉시 반영(승인 불필요 — 판정 범위만 넓어짐. 좁아지는 변경은 재승인) |

---

## 4. 표 규모가 어떻게 바뀌나 (예: 규칙 20줄, 새 성분 8줄, 새 계열 1개를 받았을 때)

| 표 | 지금 | 받은 뒤 | 늘어나는 이유 |
|---|---|---|---|
| `interaction_rule` | 75 | 95 | 조합 20 |
| `interaction_rule_side` | 약 160 | 약 205 | 조합당 2~3항 |
| `evidence` | 57 | 60~77 | 새 출처(같은 책 같은 쪽은 재사용) |
| `rule_evidence` | 75 | 95 | 규칙당 1 |
| `substance` | 약 690 | 약 699 | 성분 8 + 계열 대표 1 |
| `substance_class` | 약 33 | 34 | 새 계열 1 |
| `substance_class_member` | — | +8~10 | 소속 |
| `condition` | 5 | 5~7 | 간질환·고령을 적었을 때만 |
| `intake_class` | 21 | 21 | 버튼은 다음 빌드로 |
| `public.*` 전부 | — | 변화 없음 | |

(지금 값은 2026-10 초 기준 근사치. 정확한 수는 적재 전 `select count(*)`로 다시 잡는다.)

---

## 5. 적재 절차 (개발자)

1. 엑셀 → 검사: ①의 A·B·조건 이름을 `substance`/`condition`에 대조, ③ 70건과 중복 대조, 빈 출처·빈 문장 표시. 걸린 줄은 연구원에게 돌려보냄.
2. SQL 파일 생성: `care-app/supabase/migrate-rules-YYYY-MM-DD.sql` — 임시 테이블에 엑셀 줄을 그대로 적고, 이름→id 조인으로 `substance` → `interaction_rule` → `interaction_rule_side` → `evidence` → `rule_evidence` 순서로 insert. 같은 code가 있으면 건너뜀(두 번 실행해도 안전).
3. SQL Editor에서 실행 (`set search_path = interaction, public;`). 실행 후 행 수 확인.
4. `cd care-app && npm run check:server` — 라이브 서버에서 앱 버튼·별칭이 여전히 풀리는지. 새 성분 이름 몇 개를 `quick_check_v1`에 직접 넣어 `resolved`에 나오는지 확인.
5. 약사 승인: 검수 뒤 `update interaction_rule set review_status='approved', is_active=true where code in (…)`.
6. 승인된 조합으로 실기기 1분 점검 → 결과 카드 캡처를 연구원에게 회신.
7. 버튼·조건 매핑이 필요한 줄은 앱 코드 변경 → 테스트(`npm test`, `check:server`) → 다음 빌드.

---

## 6. 바뀌지 **않는** 것 — 미리 답해 두는 질문

- **이미 저장된 사용자 점검 결과**(`quick_check_results`)는 바뀌지 않습니다. 그때 화면에 보였던 카드가 그대로 남습니다. 새 규칙은 다음 점검부터입니다.
- **알람·복약 기록**은 영향이 없습니다.
- **식약처 병용금기(DUR) 카드**는 `public.dur_contraindication`에서 나오므로 이 양식으로는 바뀌지 않습니다. 쉬운 말 번역을 받으려면 별도 표(사유 → 문장)가 필요합니다.
- **삭제는 하지 않습니다.** 잘못 들어간 규칙도 `rejected`로 내리고 행은 남깁니다. `interaction_rule_side.target_id`에 외래키가 없어 성분을 지우면 고아 항이 생길 수 있기 때문에, 성분 행도 지우지 않고 `aliases`를 고치는 식으로 처리합니다.
