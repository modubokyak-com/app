import React, { useEffect, useRef, useState } from "react";
import { View, Text, ScrollView, StyleSheet, Pressable, Modal, ActivityIndicator, Share, Alert } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ShieldCheck, Stethoscope, MessageCircle, X, SearchX } from "lucide-react-native";
import { BigButton } from "../components/BigButton";
import { SignInButtons } from "../components/SignInButtons";
import { useSignIn } from "../navigation/useSignIn";
import { getPatientId, getPatientName } from "../lib/storage";
import { isSignedIn } from "../lib/account";
import {
  checkedCount as countChecked, checkItems, checkedNamesLine, summarize, groupByKind,
  unmatchedDescription, QuickFinding, RuleKind,
} from "../lib/quickCheck";
import { KIND_LABEL } from "../lib/quickCheckRules";
import { buildQuickCheckShareMessage } from "../lib/quickCheckShare";
import { loadDraft, commitQuickCheckDraft } from "../lib/quickCheckDraft";
import { DISCLAIMER } from "../lib/voiceScript";
import { colors, fontSizes, spacing, radii, minTouch, shadows } from "../theme/tokens";

// 점검 결과 — 회의 2026-09-10(B안, 목업 B-1): 종류별로 전부 보여 준다.
// 결과 잠금(첫 건만 공개, 카카오 연결로 해제 — dba43a5)은 회의 2026-10-08에 없앴다. 누구에게나 전부 보인다.
// 점검은 로그인 없이 된다. 아래 버튼 (회의 2026-10-09, 로그인 전은 회의 2026-10-11로 바뀜):
//   로그인 전 — 저장 카드(가입하면 이 결과를 저장하고 다시 볼 수 있다 + 「카카오로 시작하기」, iOS는 Apple도)에서
//     이 화면에서 바로 로그인한다(useSignIn, purpose "save": 쓰던 계정이면 결과 저장 후 알람 설정, 처음이면 동의 화면).
//     그 아래 「복용분석 다시하기」 하나만 둔다. 「나중에 할게요」는 뺐다 — 인트로 시작 장으로 되돌아가서
//     점검으로 되돌아가는 것처럼 보여 「복용분석 다시하기」와 헷갈렸다. 로그인 전에는 가입만 앞으로 가는 길이고,
//     알람은 가입 뒤 알람 설정 화면에서 「나중에 설정할게요」로 건너뛴다.
//   로그인 후 — 「복용 알람 시간 정하기」(결과를 저장하고 알람 설정으로) · 「복용분석 다시하기」 · 「나중에 할게요」(홈).
//   지난 결과에서 열면(from: "history") — 「복용분석 다시하기」 · 「닫기」.
//   대조한 이름이 2개 미만이면 조합 결과가 없다 — 「다시 고르기」 + 로그인 후엔 「나중에 할게요」(홈),
//     로그인 전엔 가입 카드(가입하면 복용 알람을 맞춰 드린다 + 「카카오로 시작하기」). 위 저장 카드와 같은 길이라
//     가입 뒤 고른 이름 그대로 알람 설정으로 간다(「나중에 설정할게요」도 있다). 회의 2026-10-11 취지, 사용자 확인 2026-10-14.
// 결과 데이터: 앞 화면(Analyzing·로그인 직후·지난 점검)이 params로 넘긴 것을 우선 쓰고,
// 없으면(로그인 전이거나 저장 실패로 초안이 남은 경우) 기기 초안에서 읽는다.

type State =
  | { phase: "loading" }
  | { phase: "empty" }
  // names: 대조한 이름 전부(부제용). unmatched: 자료에서 못 찾아 대조에서 빠진 입력 이름.
  // checkedCount: 실제로 대조한 이름 수 = names − unmatched.
  | {
      phase: "ok"; findings: QuickFinding[]; names: string[]; unmatched: string[]; checkedCount: number;
      durUnavailable: boolean; unmappedIngredients: string[]; uncoveredConditions: string[];
      engine?: "server" | "local";
    };

// kind별 태그 색(우선=빨강, 시간=파랑, 중복=주황).
const KIND_COLOR: Record<RuleKind, { fg: string; bg: string }> = {
  priority: { fg: colors.dangerRed, bg: colors.dangerSoft },
  timing: { fg: colors.primaryBlue, bg: colors.primarySoft },
  overlap: { fg: colors.warningOrange, bg: colors.warningSoft },
  caution: { fg: colors.textSecondary, bg: colors.canvasMuted },
};

// 근거 수준(서버 판정에만 있음) → 표시 라벨. 없는 값(none_known 등)은 보여 주지 않는다.
const EVIDENCE_LABEL: Record<string, string> = {
  established: "연구로 확인됨",
  theoretical: "가능성 있음",
  limited: "가능성 있음",
  conflicting: "의견이 갈림",
};

function FindingCard({ f }: { f: QuickFinding }) {
  const c = KIND_COLOR[f.kind];
  const evidence = f.evidenceLevel ? EVIDENCE_LABEL[f.evidenceLevel] : undefined;
  return (
    <View style={styles.card}>
      <View style={[styles.tag, { backgroundColor: c.bg }]}>
        <Text style={[styles.tagText, { color: c.fg }]}>{f.tag}</Text>
      </View>
      <Text style={styles.cardTitle}>{f.title}</Text>
      <Text style={styles.cardMsg}>{f.message}</Text>
      {typeof f.minSeparationHours === "number" ? (
        <Text style={styles.separation}>{`권장 간격: ${f.minSeparationHours}시간`}</Text>
      ) : null}
      {f.source === "dur" && f.notice_no ? <Text style={styles.source}>{`근거: 식약처 DUR 고시 ${f.notice_no}`}</Text> : null}
      <View style={styles.divider} />
      <View style={styles.pharmRow}>
        <View style={styles.pharmPill}><Text style={styles.pharmPillText}>약사 확인 권장</Text></View>
        {evidence ? <Text style={styles.evidenceText}>{evidence}</Text> : null}
        <Text style={styles.pharmNote}>복용 방법은 약사 또는 의료진과 확인해주세요.</Text>
      </View>
    </View>
  );
}

export function QuickCheckResultScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<State>({ phase: "loading" });
  const [name, setName] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const fromHistory = route.params?.from === "history";
  // 로그인했나 — 아래 버튼 묶음을 고른다(확인 전에는 버튼을 그리지 않는다). 알람 버튼을 누를 때는 다시 확인한다
  // (그사이 세션이 없어졌을 수 있다).
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void isSignedIn().then((v) => { if (alive) setSignedIn(v); });
    return () => { alive = false; };
  }, []);
  // 두 번 눌러 알람 설정·로그인 화면이 두 번 열리지 않게(입력을 잠그는 게 아니라 재진입만 막는다).
  const leaving = useRef(false);
  // 결과 화면에서 바로 로그인 — 로그인 뒤 이 결과를 저장하고 점검한 이름 그대로 알람을 맞춘다(afterLogin "save").
  const { busy, signIn, isBusy } = useSignIn("save", state.phase === "ok" ? state.names : undefined);

  useEffect(() => {
    let alive = true;
    (async () => {
      const patientName = await getPatientName();
      const paramFindings = route.params?.findings as QuickFinding[] | undefined;
      let next: State;
      if (paramFindings) {
        // commit이 초안을 지웠으므로 전부 params에서 읽는다.
        const names = (route.params?.names as string[] | undefined) ?? [];
        const unmatched = (route.params?.unmatched as string[] | undefined) ?? [];
        next = {
          phase: "ok", findings: paramFindings, names, unmatched,
          checkedCount: Math.max(0, names.length - unmatched.length),
          durUnavailable: Boolean(route.params?.durUnavailable),
          unmappedIngredients: (route.params?.unmappedIngredients as string[] | undefined) ?? [],
          uncoveredConditions: (route.params?.uncoveredConditions as string[] | undefined) ?? [],
          engine: route.params?.engine as "server" | "local" | undefined,
        };
      } else {
        const d = await loadDraft();
        next = !d?.findings ? { phase: "empty" } : {
          phase: "ok", findings: d.findings, names: checkItems(d), unmatched: d.unmatched,
          checkedCount: countChecked(d),
          durUnavailable: d.durUnavailable === true,
          unmappedIngredients: d.unmappedIngredients ?? [],
          uncoveredConditions: d.uncoveredConditions ?? [],
          engine: d.engine,
        };
      }
      if (!alive) return;
      setName(patientName);
      setState(next);
    })();
    return () => { alive = false; };
  }, [route.params]);

  // 점검한 이름을 그대로 넘겨 약마다 시간대를 고르게 한다(회의 2026-09-06·09-12).
  // 쌓아서 연다 — 알람 설정·로그인에서 뒤로 가면 이 결과로 돌아온다(회의 2026-10-06).
  async function toAlarm() {
    if (leaving.current) return;
    leaving.current = true;
    try {
      const medicines = state.phase === "ok" ? state.names : [];
      if (!(await isSignedIn())) {
        nav.navigate("Login", { purpose: "save", medicines });
        return;
      }
      // 초안에서 읽은 결과(params 없음)는 아직 서버에 없다 — 지금 저장해 둔다.
      // 실패해도 알람 설정은 막지 않는다: 초안이 남아 홈이 다시 저장을 시도한다.
      if (!route.params?.findings) {
        const pid = await getPatientId();
        if (pid) {
          try { await commitQuickCheckDraft(pid); } catch (e) { console.warn("QuickCheckResult: 결과 저장 실패", (e as Error)?.message ?? e); }
        }
      }
      nav.navigate("VoiceGuide", { medicines });
    } finally {
      leaving.current = false;
    }
  }
  // 로그인 후 「나중에 할게요」 → 홈. 로그인 전 화면에는 이 버튼이 없지만(회의 2026-10-11),
  // 로그인 전이면 홈이 없어 인트로 시작 장(1분 점검 · 건너뛰기 · 로그인)으로 돌아가게 둔다 — 방어용.
  async function later() {
    if (leaving.current || isBusy()) return;
    leaving.current = true;
    try {
      if (await isSignedIn()) nav.reset({ index: 0, routes: [{ name: "Tabs" }] });
      else nav.reset({ index: 0, routes: [{ name: "Intro", params: { slide: "cta" } }] });
    } finally {
      leaving.current = false;
    }
  }
  // 「복용분석 다시하기」·「다시 고르기」 — 앞서 고른 것(기기 초안)이 채워진 채로 1/3부터 연다. 바꿔서 다시 점검하면 된다.
  // 지난 결과에서 열었으면 쌓는다 — 뒤로 가면 이 결과로 돌아온다.
  // 점검 직후 결과면 이 결과 위에 쌓지 않고 점검부터 다시 — 1/3의 「뒤로」는 로그인했으면 홈, 아니면 인트로 시작 장.
  function recheck() {
    if (leaving.current || isBusy()) return;
    if (fromHistory) nav.navigate("QuickCheckInput");
    else nav.reset({ index: 0, routes: [{ name: "QuickCheckInput", params: { from: "intro" } }] });
  }
  // 시스템 공유 시트 — 카카오톡은 여기서 고른다(카카오 SDK 없음). 취소는 조용히, 실패만 알린다.
  // 아래 「가족과 지인도…」 시트(Modal)는 공유창이 닫힌 뒤에 닫는다. iOS 는 Modal 이 닫히는 도중에는
  // 공유창을 띄우지 못해, 시트를 먼저 닫으면 아무것도 안 뜨고 시트만 내려간다(2026-10-15 시뮬레이터에서 재현).
  // 공유창은 시트 위에 뜨고, iOS 공유창 안의 「복사」로 링크만 복사할 수도 있다.
  async function share() {
    try {
      await Share.share({ message: buildQuickCheckShareMessage() });
    } catch (e) {
      Alert.alert("보내지 못했어요", e instanceof Error && e.message ? e.message : "잠시 후 다시 시도해 주세요.",
        [{ text: "확인", onPress: () => setShareOpen(false) }]);
      return;
    }
    setShareOpen(false);
  }

  const findings = state.phase === "ok" ? state.findings : [];
  const names = state.phase === "ok" ? state.names : [];
  const unmatched = state.phase === "ok" ? state.unmatched : [];
  const unmappedIngredients = state.phase === "ok" ? state.unmappedIngredients : [];
  // 서버가 아직 판정하지 못하는 기본 정보(신장질환, 간질환 — 연령대는 제외).
  // (판정은 서버 전용이다. engine="local" 은 내장 규칙이 있던 구버전 저장분에만 남아 있다.)
  const uncoveredConditions = state.phase === "ok" ? state.uncoveredConditions : [];
  // 대조한 이름이 2개 미만이면 조합 점검 자체가 성립하지 않는다 — "이상 없음"이라 하면 안 된다.
  const nothingChecked = state.phase === "ok" && state.checkedCount < 2;
  const summary = summarize(findings);
  const namesLine = checkedNamesLine(names);
  const title = summary.total > 0
    ? `${name ? `${name}님, ` : ""}확인 필요 ${summary.total}건`
    : nothingChecked ? "복용 조합 점검이 끝났어요." : "확인된 주의 조합이 없어요";

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={[styles.c, { paddingBottom: spacing.xl + insets.bottom }]}>
        {state.phase === "loading" ? (
          <View style={styles.center}><ActivityIndicator size="large" color={colors.primaryBlue} /></View>
        ) : null}

        {state.phase === "empty" ? (
          <View style={styles.safe}>
            <Text style={styles.safeDesc}>점검 결과가 없어요. 처음부터 다시 점검해 주세요.</Text>
            <BigButton label="복용분석 다시하기" variant="secondary" onPress={recheck} />
          </View>
        ) : null}

        {/* ① 제목 · ② 대조한 이름 */}
        {state.phase === "ok" ? (
          <>
            <Text style={styles.title}>{title}</Text>
            {namesLine ? <Text style={styles.subtitle}>{namesLine}</Text> : null}
          </>
        ) : null}

        {/* ③ 안내 노트 — 제품명 대조를 못 한 채 저장된 구버전 결과(지금 판정은 서버 전용이라 새로 생기지 않는다) */}
        {state.phase === "ok" && state.durUnavailable && !fromHistory ? (
          <View style={styles.durNote}>
            <Text style={styles.note}>인터넷 연결 문제로 제품명 자료 대조는 하지 못했어요. 연결을 확인하고 다시 대조해 보세요.</Text>
            <BigButton label="제품명 다시 대조하기" variant="secondary" onPress={() => nav.replace("QuickCheckAnalyzing")} />
          </View>
        ) : null}

        {/* 자료에서 못 찾은 제품명 — 성분을 알 수 없어 점검에서 빠진다 */}
        {state.phase === "ok" && unmatched.length > 0 ? (
          <View style={styles.unmatched}>
            <View style={styles.unmatchedHead}>
              <SearchX size={24} color={colors.warningOrange} />
              <Text style={styles.unmatchedTitle}>점검하지 못한 항목 {unmatched.length}개</Text>
            </View>
            <Text style={styles.unmatchedNames}>{unmatched.join(" · ")}</Text>
            <Text style={styles.unmatchedDesc}>{unmatchedDescription(unmatched)}</Text>
          </View>
        ) : null}

        {/* 서버 조건 규칙이 없는 기본 정보 — 결과에 반영되지 않았음을 숨기지 않는다 */}
        {state.phase === "ok" && uncoveredConditions.length > 0 ? (
          <View style={styles.durNote}>
            <Text style={styles.note}>{`이번 점검에서 아직 확인하지 못한 정보: ${uncoveredConditions.join(" · ")}`}</Text>
            <Text style={styles.note}>약사에게 함께 말씀해 주세요.</Text>
          </View>
        ) : null}

        {/* 제품은 찾았지만 성분 매핑이 없던 원료 — 점검 단위(입력 이름)가 아니라 따로 알린다 */}
        {state.phase === "ok" && unmappedIngredients.length > 0 ? (
          <Text style={styles.note}>{`성분을 확인하지 못한 원료: ${unmappedIngredients.join(" · ")}`}</Text>
        ) : null}

        {/* ④ 0건 — 약사 문장은 하단 고지 한 곳으로 모은다 */}
        {state.phase === "ok" && summary.total === 0 && !nothingChecked ? (
          <View style={styles.safe}>
            <ShieldCheck size={44} color={colors.successGreen} />
            <Text style={styles.safeDesc}>고르신 약과 영양제 사이에 알려진 주의 조합은 없었어요.</Text>
          </View>
        ) : null}

        {/* ⑤ 종류별 전부 — 누구에게나 전부 보여 준다(잠금 없음, 회의 2026-10-08) */}
        {state.phase === "ok" && summary.total > 0 ? (
          groupByKind(findings).map((g) => (
            <View key={g.kind} style={styles.group}>
              <Text style={styles.section}>{`${KIND_LABEL[g.kind]} ${g.items.length}건`}</Text>
              {g.items.map((f, i) => <FindingCard key={`${f.kind}|${f.a}|${f.b}|${i}`} f={f} />)}
            </View>
          ))
        ) : null}

        {/* ⑥ 대조 2개 미만 — 조합 점검이 성립하지 않는다 */}
        {state.phase === "ok" && nothingChecked ? (
          <View style={styles.safe}>
            <Text style={styles.safeTitle}>점검할 조합이 부족해요</Text>
            <Text style={styles.safeDesc}>약과 영양제를 두 가지 이상 고르면 함께 먹어도 되는지 확인할 수 있어요.</Text>
          </View>
        ) : null}

        {/* ⑦ 버튼 — 지난 결과 / 2개 미만 / 로그인 후 / 로그인 전(저장 카드). 로그인 여부를 확인하기 전에는 그리지 않는다 */}
        {state.phase === "ok" && fromHistory ? (
          <View style={styles.actions}>
            <BigButton label="복용분석 다시하기" onPress={recheck} showArrow />
            <BigButton label="닫기" variant="secondary" onPress={() => nav.goBack()} />
          </View>
        ) : null}
        {state.phase === "ok" && !fromHistory && nothingChecked && signedIn !== null ? (
          <View style={styles.actions}>
            <BigButton label="다시 고르기" onPress={recheck} showArrow disabled={busy !== null} />
            {signedIn ? (
              <BigButton label="나중에 할게요" variant="secondary" onPress={() => { void later(); }} />
            ) : (
              <View style={styles.saveCard}>
                {/* 한 줄로 — 좁은 화면에서는 줄이 바뀌며 단어가 쪼개지지 않게 글자를 조금 줄인다 */}
                <Text style={styles.saveTitle} accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                  가입하면 복용 알람을 맞춰 드려요
                </Text>
                <SignInButtons kakaoLabel="카카오로 시작하기" busy={busy} onPress={(kind) => { void signIn(kind); }} />
              </View>
            )}
          </View>
        ) : null}
        {state.phase === "ok" && !fromHistory && !nothingChecked && signedIn === true ? (
          <View style={styles.actions}>
            <BigButton label="복용 알람 시간 정하기" onPress={() => { void toAlarm(); }} showArrow />
            <BigButton label="복용분석 다시하기" variant="secondary" onPress={recheck} />
            <BigButton label="나중에 할게요" variant="secondary" onPress={() => { void later(); }} />
          </View>
        ) : null}
        {state.phase === "ok" && !fromHistory && !nothingChecked && signedIn === false ? (
          <View style={styles.actions}>
            <View style={styles.saveCard}>
              {/* 줄은 직접 나눈다 — 한글은 글자 단위로 줄이 바뀌어 단어가 쪼개진다 */}
              <Text style={styles.saveTitle} accessibilityRole="header">{"가입하면 이 결과를 저장하고\n언제든 다시 볼 수 있어요"}</Text>
              <Text style={styles.saveSub}>복용 알람도 함께 맞춰 드려요.</Text>
              <SignInButtons kakaoLabel="카카오로 시작하기" busy={busy} onPress={(kind) => { void signIn(kind); }} />
            </View>
            <BigButton label="복용분석 다시하기" variant="secondary" onPress={recheck} disabled={busy !== null} />
          </View>
        ) : null}

        {/* ⑧ 공유 — 한 줄 링크 */}
        {state.phase === "ok" ? (
          <Pressable onPress={() => setShareOpen(true)} style={({ pressed }) => [styles.shareBtn, pressed && { opacity: 0.85 }]} accessibilityRole="button">
            <View style={styles.kakaoDot}><MessageCircle size={16} color={colors.kakaoInk} fill={colors.kakaoInk} /></View>
            <Text style={styles.shareBtnText}>가족·지인에게 1분 점검 보내기</Text>
          </Pressable>
        ) : null}

        {/* ⑨ 고지 — 약사 확인 한 번 + 면책 한 번 */}
        {state.phase === "ok" ? (
          <>
            <View style={styles.notice}>
              <Stethoscope size={22} color={colors.primaryNavy} />
              <Text style={styles.noticeText}>
                스스로 약을 끊거나 바꾸지 마시고,{" "}
                <Text style={styles.noticeStrong}>약사나 의사에게 꼭 확인하세요.</Text>
              </Text>
            </View>
            <Text style={styles.disclaimer}>{DISCLAIMER}</Text>
          </>
        ) : null}
      </ScrollView>

      {/* 공유 시트 */}
      <Modal visible={shareOpen} transparent animationType="slide" onRequestClose={() => setShareOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setShareOpen(false)} accessibilityLabel="닫기" />
        <View style={[styles.sheet, { paddingBottom: spacing.lg + insets.bottom }]}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>가족과 지인도 함께 건강해지기</Text>
            <Pressable onPress={() => setShareOpen(false)} hitSlop={10} style={styles.sheetClose} accessibilityRole="button" accessibilityLabel="닫기">
              <X size={24} color={colors.textSecondary} />
            </Pressable>
          </View>
          <Text style={styles.sheetSub}>약과 영양제를 함께 먹는 조합도 간단하게 확인해보세요.</Text>
          <Pressable onPress={() => { void share(); }} style={({ pressed }) => [styles.kakaoBtn, pressed && { opacity: 0.85 }]} accessibilityRole="button">
            <MessageCircle size={22} color={colors.kakaoInk} fill={colors.kakaoInk} />
            <Text style={styles.kakaoText}>카카오톡으로 1분 점검 보내기</Text>
          </Pressable>
          <Text style={styles.sheetCaption}>내 분석 결과는 공유되지 않아요.</Text>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  c: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.md },
  title: { fontSize: 28, lineHeight: 38, fontWeight: "800", color: colors.primaryNavy, letterSpacing: -0.6 },
  subtitle: { fontSize: fontSizes.body, lineHeight: 26, fontWeight: "600", color: colors.textSecondary, marginTop: -spacing.sm },
  center: { alignItems: "center", marginTop: spacing.xl },
  section: { fontSize: 21, fontWeight: "800", color: colors.primaryNavy, letterSpacing: -0.4, marginTop: spacing.sm },
  divider: { height: 1, backgroundColor: colors.canvasMuted, marginVertical: spacing.sm },
  durNote: { gap: 4 },
  note: { fontSize: fontSizes.body, lineHeight: 26, color: colors.textSecondary },

  card: { backgroundColor: colors.cardBg, borderColor: colors.border, borderWidth: 1, borderRadius: radii.card, padding: spacing.md, ...shadows.card },
  tag: { alignSelf: "flex-start", borderRadius: radii.pill, paddingHorizontal: 12, minHeight: 32, justifyContent: "center" },
  tagText: { fontSize: 18, fontWeight: "700" },
  cardTitle: { fontSize: 23, fontWeight: "800", color: colors.primaryNavy, letterSpacing: -0.4, marginTop: spacing.sm + 4 },
  cardMsg: { fontSize: 19, lineHeight: 29, fontWeight: "600", color: colors.text, marginTop: spacing.sm },
  separation: { fontSize: 18, lineHeight: 26, fontWeight: "700", color: colors.primaryNavy, marginTop: spacing.sm },
  evidenceText: { fontSize: 18, fontWeight: "700", color: colors.textSecondary },
  source: { fontSize: 18, color: colors.textSecondary, marginTop: spacing.sm },
  pharmRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  pharmPill: { backgroundColor: colors.successSoft, borderRadius: radii.pill, paddingHorizontal: 12, minHeight: 32, justifyContent: "center" },
  pharmPillText: { fontSize: 18, fontWeight: "700", color: colors.successGreen },
  pharmNote: { flex: 1, fontSize: 18, lineHeight: 24, fontWeight: "600", color: colors.textSecondary, minWidth: 160 },

  group: { gap: spacing.md },
  actions: { marginTop: spacing.sm, gap: spacing.sm },
  saveCard: {
    backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderWidth: 1, borderRadius: radii.card,
    padding: spacing.md, gap: spacing.sm, ...shadows.card,
  },
  saveTitle: { fontSize: 21, lineHeight: 30, fontWeight: "800", color: colors.primaryNavy, letterSpacing: -0.4 },
  saveSub: { fontSize: fontSizes.body, lineHeight: 26, color: colors.textSecondary, marginBottom: spacing.xs },

  shareBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, minHeight: minTouch,
    borderRadius: radii.pill, backgroundColor: colors.surfaceRaised, borderWidth: 1.5, borderColor: colors.border,
  },
  kakaoDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.kakao, alignItems: "center", justifyContent: "center" },
  shareBtnText: { fontSize: fontSizes.body, fontWeight: "800", color: colors.primaryNavy },

  unmatched: { backgroundColor: colors.warningSoft, borderRadius: radii.card, padding: spacing.md, gap: spacing.sm, borderWidth: 1, borderColor: colors.warningOrange },
  unmatchedHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  unmatchedTitle: { fontSize: 20, fontWeight: "800", color: colors.primaryNavy },
  unmatchedNames: { fontSize: fontSizes.body, fontWeight: "700", color: colors.text, lineHeight: 26 },
  unmatchedDesc: { fontSize: fontSizes.body, color: colors.textSecondary, lineHeight: 27 },
  safe: { alignItems: "center", gap: spacing.sm, backgroundColor: colors.cardBg, borderColor: colors.border, borderWidth: 1, borderRadius: radii.card, padding: spacing.lg },
  safeTitle: { fontSize: 24, fontWeight: "800", color: colors.primaryNavy, textAlign: "center" },
  safeDesc: { fontSize: 19, color: colors.textSecondary, textAlign: "center", lineHeight: 28 },
  notice: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start", backgroundColor: colors.lightBlueBg, borderRadius: radii.card, padding: spacing.md },
  noticeText: { flex: 1, fontSize: 19, color: colors.primaryNavy, lineHeight: 28 },
  noticeStrong: { fontWeight: "800" },
  disclaimer: { fontSize: 18, lineHeight: 22, color: colors.textSecondary, textAlign: "center" },

  backdrop: { flex: 1, backgroundColor: colors.overlayStrong },
  sheet: { backgroundColor: colors.surfaceRaised, borderTopLeftRadius: radii.hero, borderTopRightRadius: radii.hero, padding: spacing.lg, gap: spacing.md, ...shadows.floating },
  sheetHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  sheetTitle: { flex: 1, fontSize: 22, lineHeight: 32, fontWeight: "800", color: colors.primaryNavy, letterSpacing: -0.4 },
  sheetClose: { width: 44, height: 44, alignItems: "flex-end", justifyContent: "center" },
  sheetSub: { fontSize: fontSizes.body, lineHeight: 26, color: colors.textSecondary, marginTop: -spacing.sm },
  sheetCaption: { fontSize: 18, fontWeight: "600", color: colors.textSecondary, textAlign: "center" },
  kakaoBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, minHeight: minTouch, borderRadius: radii.pill, backgroundColor: colors.kakao },
  kakaoText: { fontSize: fontSizes.emphasis, fontWeight: "800", color: colors.kakaoInk },
});
