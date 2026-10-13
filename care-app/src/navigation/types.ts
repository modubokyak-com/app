// 로그인을 묻는 까닭 — 화면 제목과 로그인 뒤 갈 곳이 달라진다(회의 2026-10-08).
//  save: 점검 결과를 저장하고 알람을 맞추려고 · skip: 인트로 「지금은 건너뛰기」 · returning: 이미 쓰던 계정
export type LoginPurpose = "save" | "skip" | "returning";

export type RootStackParamList = {
  // slide: 점검 1/3에서 「뒤로」로 돌아올 때 시작 화면(마지막 장)을 바로 보인다.
  Intro: { slide?: "cta" } | undefined;
  // medicines: purpose "save"일 때 방금 점검한 이름 — 로그인 뒤 이 이름 그대로 알람을 맞춘다.
  Login: { purpose: LoginPurpose; medicines?: string[] };
  // 처음 로그인한 사람만 온다. appleFullName: Apple이 첫 로그인에만 주는 이름(이름 칸 미리 채우기).
  // existingPatientId: 옛 빌드에서 이어 붙어 환자 행은 있는데 동의 기록이 없는 계정 — 동의만 채운다.
  Consent: { purpose: LoginPurpose; medicines?: string[]; appleFullName?: string | null; existingPatientId?: string };
  Account: undefined;
  QuickCheckHistory: undefined;
  AlarmPrompt: undefined;
  Tabs: undefined;
  // medicines: 1분 점검에서 방금 대조한 이름(Case A) — 이 이름 그대로 알람을 맞춘다.
  // 없으면(알람 물음에서 온 Case C) 하루 횟수만 묻는다. 회의 2026-09-06·09-12.
  // from "login": 결과 화면 저장 카드에서 로그인(가입)한 직후 — 알람 설정을 직접 고른 게 아니라
  // 「나중에 설정할게요」를 보인다(회의 2026-10-11).
  // saved: 방금 점검 결과를 서버에 저장했다 — 맨 위에 「분석 결과를 저장했어요」.
  VoiceGuide: { medicines?: string[]; from?: "login"; saved?: boolean } | undefined;
  RegisterMethod: undefined;
  ButtonRegister: { editId?: string } | undefined;
  OcrRegister: undefined;
  MedicineSearch: undefined;
  DoseTime: { medicineName: string };
  Alarm: import("../lib/alarmPayload").AlarmRouteParams;
  SnoozePicker: { scheduleId: string };
  SnoozeCountdown: { scheduleId: string; fireAt: string; hour: number; minute: number };
  Checkup: undefined;
  AlarmSound: undefined;
  // from: 동의 화면에서 「보기」로 열면 「모든 데이터 삭제」를 숨긴다(아직 가입 전).
  Privacy: { from?: "consent" } | undefined;
  MedicineDetail: { scheduleId: string };
  Interaction: undefined;
  // from: 인트로에서 들어왔으면 1/3의 「뒤로」가 인트로로 돌아간다(회의 2026-09-20).
  QuickCheckInput: { from?: "intro" } | undefined;
  QuickCheckAnalyzing: undefined;
  // findings: 초안이 서버로 옮겨져(지워져) 기기에 없을 수 있어 앞 화면이 넘겨준다.
  // names: 대조한 이름 전부(부제·대조 수 계산용). 대조 수 = names.length - unmatched.length.
  QuickCheckResult: {
    findings?: import("../lib/quickCheckRules").QuickFinding[]; unmatched?: string[]; names?: string[]; durUnavailable?: boolean;
    unmappedIngredients?: string[]; uncoveredConditions?: string[]; engine?: "server" | "local";
    // from: "history" — 더보기 「내 복용분석 결과 보기」 목록에서 다시 연 결과. 아래 버튼은 「복용분석 다시하기」·「닫기」.
    from?: "history";
  } | undefined;
};
export type TabParamList = {
  Home: undefined;
  Cabinet: undefined;
  Record: undefined;
  More: undefined;
};
