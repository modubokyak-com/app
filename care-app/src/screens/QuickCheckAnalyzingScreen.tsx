import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Check, ShieldCheck } from "lucide-react-native";
import { BigButton } from "../components/BigButton";
import { checkItems, QuickCheckDraft, QuickFinding, PRESET_LABELS } from "../lib/quickCheck";
import { expandChipNames } from "../lib/chipAliases";
import { runServerCheck, serverToFindings, ServerCheckResult } from "../lib/quickCheckServer";
import { serverConditionInput } from "../lib/conditionAliases";
import { loadDraft, saveDraft, commitQuickCheckDraft, resultParamsOf } from "../lib/quickCheckDraft";
import { getPatientId } from "../lib/storage";
import { trackApp } from "../lib/appStats";
import { colors, fontSizes, spacing, radii, shadows } from "../theme/tokens";

// 점검 중 화면 — 판정을 돌리면서 4단계 체크리스트를 순서대로 켠다.
//  · 판정은 서버(quick_check_v1 RPC) **전용** — 약사 검수를 거친 DB 문구를 그대로 받는다.
//  · 서버 실패(에러·10초 타임아웃)면 판정하지 않는다(2026-09-17 결정). 인터넷 연결 안내와
//    "다시 시도하기"만 보여 준다. 앱 내장 규칙·기기 DUR 폴백은 제거됐다 — 되살리지 말 것.
//  · 종류명 칩은 chipAliases 로 서버 계열·성분 이름을 덧붙여 보내고, 응답에서 다시 칩 이름으로 되돌린다.
// 조회가 순식간에 끝나도 최소 시간은 보여 준다 — 바로 넘어가면 "정말 봤나?" 싶어진다.
// 판정이 끝나면 로그인한 사람(기기에 환자 id가 있다)은 곧바로 서버(quick_check_results)에 저장한다.
// 로그인 전이면 저장하지 않고 기기 초안의 결과만 보여 준다 — 저장은 결과 화면에서 로그인한 뒤에
// 한다(afterLogin). 저장에 실패해도 결과는 보여 주고, 초안은 남겨 HomeScreen이 재시도한다.

const STEPS = ["약과 영양제 조합 확인", "성분 확인", "주의 조합 대조", "결과 정리"] as const;
const MIN_MS = 2400;
const STEP_MS = MIN_MS / STEPS.length;

type Analysis =
  | {
      ok: true; findings: QuickFinding[]; unmatched: string[]; durUnavailable: false;
      engine: "server"; unmappedIngredients: string[]; uncoveredConditions: string[];
    }
  | { ok: false };

// 서버 판정(quick_check_v1)만 — 검수된 문구를 그대로 받는다. 실패(throw)하면 ok:false 로
// 돌려 화면이 연결 안내를 보여 준다. 로컬로 대신 판정하지 않는다.
async function analyze(draft: QuickCheckDraft): Promise<Analysis> {
  // 서버는 조건을 name_ko 문자열로만 비교한다 — 앱 라벨에 서버 조건명 별칭을 덧붙여 보내고,
  // 서버가 판정하지 못하는 라벨(uncovered)은 결과 화면에서 알린다.
  const cond = serverConditionInput(draft.profile);
  // 칩 이름에도 서버 계열·성분 별칭을 덧붙인다(혈압약 → +칼슘통로차단제·RAS차단제 …, 유산균 → 프로바이오틱스).
  // 초안의 names·checkedCount 는 사용자 입력(checkItems)만 쓴다 — 별칭은 응답에서 칩 이름으로 되돌린다.
  const { send, aliasOf } = expandChipNames(checkItems(draft));
  let res: ServerCheckResult;
  try {
    res = await runServerCheck({ names: send, age: cond.age, conditions: cond.conditions });
  } catch {
    return { ok: false };
  }
  // 칩이 제대로 풀리지 않은 것(알레르기약→성분 없음 등)도 "점검하지 못한 항목"으로.
  const mapped = serverToFindings(res, PRESET_LABELS, aliasOf);
  return {
    ok: true, findings: mapped.findings,
    // unmatched는 **입력 이름**만(unresolved) — checkedCount가 입력 이름 수에서 빼는 단위라
    // 원료명을 섞으면 계산이 깨진다. 원료명은 unmappedIngredients로 따로 싣는다.
    unmatched: mapped.unresolved,
    unmappedIngredients: mapped.unmappedIngredients,
    uncoveredConditions: cond.uncovered,
    durUnavailable: false, engine: "server",
  };
}

export function QuickCheckAnalyzingScreen() {
  const nav = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [done, setDone] = useState(0);          // 켜진 체크 개수
  const [failed, setFailed] = useState<null | "network" | "storage">(null);
  const [attempt, setAttempt] = useState(0);
  // 실패 화면의 보조 버튼 — 환자가 있으면(로그인) 홈으로, 없으면 로그인해서 시작하기로.
  const [hasPatient, setHasPatient] = useState(false);
  useEffect(() => {
    let alive = true;
    void getPatientId().then((pid) => { if (alive) setHasPatient(pid !== null); });
    return () => { alive = false; };
  }, []);

  const run = useCallback(async (alive: () => boolean) => {
    // 실패 화면에 들어설 때마다 센다(다시 시도해 또 실패하면 또 센다).
    const fail = (why: "network" | "storage") => { trackApp("check_failed"); setFailed(why); };
    setFailed(null);
    setDone(0);
    // 체크리스트는 시간에 맞춰 켠다(조회 진행과 무관 — 조회는 보통 더 빨리 끝난다).
    const timers = STEPS.map((_, i) => setTimeout(() => { if (alive()) setDone(i + 1); }, STEP_MS * (i + 1)));
    const started = Date.now();
    try {
      const draft = await loadDraft();
      if (!draft) throw new Error("no draft");
      const r = await analyze(draft);
      if (!alive()) return;
      // 실패는 바로 알린다 — 최소 표시 시간은 성공했을 때만 채운다.
      if (!r.ok) { timers.forEach(clearTimeout); fail("network"); return; }
      try {
        await saveDraft({
          ...draft, findings: r.findings, unmatched: r.unmatched, durUnavailable: r.durUnavailable,
          // 이전 판정의 값이 남지 않게 항상 덮어쓴다.
          unmappedIngredients: r.unmappedIngredients,
          uncoveredConditions: r.uncoveredConditions,
          engine: r.engine, analyzedAt: new Date().toISOString(),
        });
      } catch {
        timers.forEach(clearTimeout);
        if (alive()) fail("storage");
        return;
      }
      // 서버 저장(로그인한 사람만). 실패는 여기서 삼킨다 — 초안이 기기에 남아 HomeScreen이 홈에
      // 들어올 때마다 다시 시도하고, 결과 화면은 초안에서 읽으면 되므로 사용자를 막지 않는다.
      const pid = await getPatientId();
      let committed: QuickCheckDraft | null = null;
      if (pid) {
        try { committed = await commitQuickCheckDraft(pid); } catch { committed = null; }
      }
      const wait = Math.max(0, MIN_MS - (Date.now() - started));
      await new Promise((res) => setTimeout(res, wait));
      if (!alive()) return;
      // 새로 판정해 결과 화면으로 넘어가는 순간 — 기록에서 결과를 다시 여는 것은 이 화면을 거치지 않아 세지 않는다.
      trackApp("check_report");
      // commit이 초안의 판정 결과를 비웠으므로(입력은 남는다) 결과는 params로 넘긴다.
      // 저장 못 했으면 초안에 결과가 남아 있어 결과 화면이 초안에서 읽는다.
      nav.replace("QuickCheckResult", committed ? resultParamsOf(committed) : undefined);
    } catch {
      timers.forEach(clearTimeout);
      if (alive()) fail("network");
    }
    return () => timers.forEach(clearTimeout);
  }, [nav]);

  useEffect(() => {
    let alive = true;
    const cleanup = run(() => alive);
    return () => { alive = false; void cleanup.then((c) => c && c()); };
  }, [run, attempt]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={[styles.c, { paddingBottom: spacing.xl + insets.bottom }]}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            {failed ? <ShieldCheck size={44} color={colors.textSecondary} /> : <ActivityIndicator size="large" color={colors.primaryBlue} />}
          </View>
          <Text style={styles.title}>
            {failed === "network" ? "인터넷에 연결되지 않았어요" : failed === "storage" ? "점검을 마치지 못했어요" : "복용 조합을 점검하고 있어요"}
          </Text>
          <Text style={styles.sub}>
            {failed === "storage"
              ? "결과를 기기에 저장하지 못했어요. 저장 공간을 확인하고 다시 시도해 주세요."
              : failed === "network"
                // 서버 판정 전용 — 인터넷이 없으면 판정 자체를 하지 않는다(내장 규칙 폴백 없음).
                ? "연결 상태를 확인한 뒤 다시 점검해 주세요. 인터넷이 없으면 복용 조합을 판정할 수 없어요."
                : "약과 영양제 조합을 확인하고 식약처 자료와 대조합니다. 잠시만 기다려 주세요."}
          </Text>
        </View>

        <View style={styles.list}>
          {STEPS.map((label, i) => {
            const on = i < done && !failed;
            const active = i === done && !failed;
            return (
              <View key={label} style={[styles.row, on && styles.rowOn]}>
                <View style={[styles.mark, on && styles.markOn]}>
                  {on ? <Check size={20} strokeWidth={3} color={colors.white} /> : active ? <ActivityIndicator size="small" color={colors.primaryBlue} /> : null}
                </View>
                <Text style={[styles.rowText, on && styles.rowTextOn]}>{label}</Text>
              </View>
            );
          })}
        </View>

        {failed ? (
          <View style={styles.actions}>
            <BigButton label="다시 시도하기" onPress={() => setAttempt((a) => a + 1)} />
            {hasPatient ? (
              <BigButton label="건너뛰고 홈으로" variant="secondary" onPress={() => nav.reset({ index: 0, routes: [{ name: "Tabs" }] })} />
            ) : (
              <BigButton label="건너뛰고 시작하기" variant="secondary" onPress={() => nav.navigate("Login", { purpose: "skip" })} />
            )}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  c: { paddingHorizontal: spacing.lg, paddingTop: spacing.xxl, gap: spacing.lg },
  hero: { alignItems: "center", gap: spacing.md },
  heroIcon: { width: 96, height: 96, borderRadius: 48, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 26, fontWeight: "800", color: colors.primaryNavy, textAlign: "center", letterSpacing: -0.5 },
  sub: { fontSize: fontSizes.body, lineHeight: 27, color: colors.textSecondary, textAlign: "center" },
  list: { gap: spacing.sm },
  row: {
    flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 64,
    paddingHorizontal: spacing.md, borderRadius: radii.card,
    backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, ...shadows.card,
  },
  rowOn: { borderColor: colors.primaryBlue },
  mark: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.canvasMuted, alignItems: "center", justifyContent: "center" },
  markOn: { backgroundColor: colors.successGreen },
  rowText: { fontSize: 20, fontWeight: "700", color: colors.textSecondary },
  rowTextOn: { color: colors.text },
  actions: { gap: spacing.xs },
});
