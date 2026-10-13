import { commitQuickCheckDraft, loadDraft, resultParamsOf } from "../lib/quickCheckDraft";
import { checkItems } from "../lib/quickCheck";
import { getPatientId } from "../lib/storage";
import { resyncAllAlarms } from "../lib/alarmSync";
import type { LoginPurpose } from "./types";

type Route = { name: string; params?: object };
type Nav = { reset: (state: { index: number; routes: Route[] }) => void };

// 로그인(이미 쓰던 계정) 또는 동의(처음 가입) 직후 어디로 갈지 — 로그인 버튼(useSignIn)·동의 화면이 같이 쓴다.
//
// save(점검 결과 화면의 저장 카드에서 로그인, 회의 2026-10-09): 기기에 남은 점검 결과를 이 환자로 저장한 뒤
//   [홈, 점검 결과, 알람 설정] 으로 쌓는다. 알람 설정에서 뒤로 가면 결과로 돌아온다(회의 2026-10-06 취지).
//   commit이 초안의 판정 결과를 비우므로 결과 화면에는 저장한 값을 params로 넘긴다. 저장에 실패하면
//   초안에 결과가 남아 있어 params 없이 열어도 초안에서 읽는다(홈이 저장을 다시 시도한다).
//   알람 설정에는 from: "login"을 넘겨 「나중에 설정할게요」(→ 홈)를 보이게 한다 — 결과 화면에는 더 이상
//   「나중에 할게요」가 없으므로 알람은 여기서 건너뛴다(회의 2026-10-11). saved는 방금 서버에 저장했는지
//   (맨 위에 「분석 결과를 저장했어요」를 보인다).
// skip·returning: 새로 가입한 사람은 알람 설정 물음으로, 이미 쓰던 사람은 바로 홈으로.
export async function continueAfterLogin(
  nav: Nav,
  args: { purpose: LoginPurpose; medicines?: string[]; isNew: boolean },
): Promise<void> {
  // 쓰던 계정을 새 휴대폰에서 불러왔으면 서버에 있는 일정으로 알람을 다시 예약한다(뒤에서, 기다리지 않는다).
  if (!args.isNew) void resyncAllAlarms().catch(() => {});
  if (args.purpose !== "save") {
    nav.reset({ index: 0, routes: [{ name: args.isNew ? "AlarmPrompt" : "Tabs" }] });
    return;
  }

  const pid = await getPatientId();
  let result: Route | null = null;
  let names: string[] = [];
  let saved = false;
  try {
    const committed = pid ? await commitQuickCheckDraft(pid) : null;
    if (committed) {
      result = { name: "QuickCheckResult", params: resultParamsOf(committed) };
      names = checkItems(committed);
      saved = true;
    }
  } catch (e) {
    console.warn("afterLogin: 점검 결과 저장 실패 — 홈에서 다시 시도한다", (e as Error)?.message ?? e);
  }
  if (!result) {
    const d = await loadDraft().catch(() => null);
    if (d?.findings) {
      result = { name: "QuickCheckResult" };
      names = checkItems(d);
    }
  }
  const medicines = args.medicines && args.medicines.length > 0 ? args.medicines : names;
  const alarm: Route = { name: "VoiceGuide", params: { medicines, from: "login", saved } };
  const routes: Route[] = result ? [{ name: "Tabs" }, result, alarm] : [{ name: "Tabs" }, alarm];
  nav.reset({ index: routes.length - 1, routes });
}
