import React, { useCallback, useEffect, useState } from "react";
import { Image, View, Text, ScrollView, StyleSheet, Pressable, Alert, ActivityIndicator } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Trash2, Stethoscope, AlertTriangle, ChevronRight, Pencil, Clock } from "lucide-react-native";
import { ScreenHeader } from "../components/ScreenHeader";
import { BigButton } from "../components/BigButton";
import { MedicineMark } from "../components/MedicineMark";
import { supabase, Schedule } from "../lib/supabase";
import { cancelSchedule } from "../lib/notifications";
import { MED_KINDS, MedKind } from "../lib/medKind";
import { getKindMap, resolveKind, setKind } from "../lib/medStore";
import { fetchDrugInfo, lookupIngredients, fetchContraindications } from "../lib/drugData";
import { allIngredients, matchFindings, MedIngredients } from "../lib/interactions";
import { getPatientId } from "../lib/storage";
import { describeDoseRepeat, describeDoseTime } from "../lib/medSummary";

import { colors, fontSizes, spacing, radii, minTouch } from "../theme/tokens";
const DETAIL_ART = require("../../assets/illustrations/medicine-detail-accent.png");

// D-02 약 상세.
// 회의 결정:
//   · "약사에게 물어보기" 버튼 제거 — 약사 시스템은 추후. 지금은 확인을 권하는 문구로 갈음.
//   · 상세 내용은 우리 데이터에 없으면 AI가 채운다.
//
// QA 2026-08-20로 바뀐 것:
//   수정은 원래 '내 약장'에서 카드를 왼쪽으로 밀어야 나왔는데, 어르신에게는
//   보이지 않는 조작이었다. 스와이프를 없애고 여기 "복약 일정" 줄마다 [수정]
//   버튼을 드러낸다. 삭제도 여기로 모았다(약장에서 사라진 경로를 대신한다).

export function MedicineDetailScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const scheduleId: string | undefined = route.params?.scheduleId;

  const [sched, setSched] = useState<Schedule | null>(null);
  // 같은 약 이름의 활성 일정 전부(아침·저녁처럼 하루 여러 번일 수 있다).
  const [doses, setDoses] = useState<Schedule[]>([]);
  const [kind, setKindState] = useState<MedKind | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);
  const [warnCount, setWarnCount] = useState<number | null>(null);
  // 일정 조회 실패. 없으면 "불러오는 중..."이 영원히 남는다 — 오류와 다시 시도를 보인다.
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!scheduleId) { setLoadFailed(true); return; }
      setLoadFailed(false);
      const { data, error } = await supabase.from("schedules").select("*").eq("id", scheduleId).single();
      if (!alive) return;
      if (error || !data) { setLoadFailed(true); return; }
      const s = data as Schedule;
      setSched(s);
      setKindState(resolveKind(s.medicine_name, await getKindMap()));

      // AI 설명 — 엣지 함수에 ?op=druginfo 가 배포돼 있어야 온다. 없으면 조용히 비운다.
      setInfoLoading(true);
      const text = await fetchDrugInfo(s.medicine_name);
      if (alive) { setInfo(text); setInfoLoading(false); }
    })();
    return () => { alive = false; };
  }, [scheduleId, attempt]);

  // 이 약이 다른 약과 부딪치는지 — 약장 배너와 같은 판정을 이 약 기준으로만 센다.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!sched) return;
      const pid = await getPatientId();
      if (!pid) return;
      const { data } = await supabase.from("schedules").select("*")
        .eq("patient_id", pid).eq("active", true);
      const all = (data ?? []) as Schedule[];
      // 이 약의 시간대 전부를 시각 순으로. 목록에서 들어온 일정 하나만 고치면
      // 아침·저녁 중 한쪽만 바뀌어 "안 고쳐졌다"로 보인다.
      if (alive) {
        setDoses(
          all.filter((x) => x.medicine_name === sched.medicine_name)
            .sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute))
        );
      }
      const names = [...new Set(all.map((s) => s.medicine_name))];
      if (names.length < 2) { if (alive) setWarnCount(0); return; }
      const ing = await lookupIngredients(names);
      if (!ing.ready) { if (alive) setWarnCount(null); return; }
      const meds: MedIngredients[] = names.map((n) => ({ scheduleId: n, name: n, ingredients: ing.data[n] ?? [] }));
      const rules = await fetchContraindications(allIngredients(meds));
      if (!rules.ready) { if (alive) setWarnCount(null); return; }
      const mine = matchFindings(meds, rules.data)
        .filter((f) => f.medA === sched.medicine_name || f.medB === sched.medicine_name);
      if (alive) setWarnCount(mine.length);
    })();
    return () => { alive = false; };
  }, [sched]);

  const chooseKind = useCallback(async (k: MedKind) => {
    if (!sched) return;
    setKindState(k);
    await setKind(sched.medicine_name, k);
  }, [sched]);

  function confirmDelete() {
    if (!sched) return;
    // 약 하나를 지우면 그 약의 모든 시간대가 함께 사라져야 한다 — 아침·저녁 중
    // 한쪽만 남으면 사용자에겐 "안 지워진" 것으로 보인다(약장 삭제와 같은 규칙).
    const targets = doses.length > 0 ? doses : [sched];
    const many = targets.length > 1 ? `\n(${targets.length}개 시간대 모두)` : "";
    Alert.alert(`'${sched.medicine_name}' 삭제`, `이 약의 복약 일정과 알림을 삭제할까요?${many}`, [
      { text: "취소", style: "cancel" },
      {
        text: "삭제", style: "destructive",
        onPress: async () => {
          try {
            for (const d of targets) {
              // 하드 삭제하면 복약 기록이 cascade로 사라진다 — 비활성화로 목록에서만 뺀다.
              const { error } = await supabase.from("schedules").update({ active: false }).eq("id", d.id);
              if (error) throw error;
              await cancelSchedule(d.id);
            }
            nav.goBack();
          } catch {
            Alert.alert("삭제에 실패했어요", "인터넷 연결을 확인하고 다시 시도해 주세요.");
          }
        },
      },
    ]);
  }

  if (!sched) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="약 상세" />
        {loadFailed ? (
          <View style={styles.loadFailed}>
            <Text style={styles.loading}>불러오지 못했어요.{"\n"}인터넷 연결을 확인해 주세요.</Text>
            <BigButton label="다시 시도" onPress={() => setAttempt((n) => n + 1)} />
          </View>
        ) : (
          <Text style={styles.loading}>불러오는 중...</Text>
        )}
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader title="약 상세" />
      <ScrollView contentContainerStyle={[styles.c, { paddingBottom: spacing.xl + insets.bottom }]}>
        {/* 이름 · 하루 몇 번 (구체적인 시각은 아래 "복약 일정"에서 수정까지 함께) */}
        <View style={styles.hero}>
          <View style={styles.heroCopy}>
            <View style={styles.heroLabel}><MedicineMark name={sched.medicine_name} size={34} /><Text style={styles.heroLabelText}>복용 중인 약</Text></View>
            <Text style={styles.name}>{sched.medicine_name}</Text>
            <Text style={styles.time}>{`하루 ${Math.max(1, doses.length)}번 복용`}</Text>
          </View>
          <Image source={DETAIL_ART} style={styles.heroArt} resizeMode="contain" />
        </View>

        {/* 주의 — 있을 때만 */}
        {warnCount !== null && warnCount > 0 ? (
          <Pressable
            onPress={() => nav.navigate("Interaction")}
            style={({ pressed }) => [styles.warn, pressed && { opacity: 0.92 }]}
            accessibilityRole="button"
          >
            <AlertTriangle size={24} color={colors.dangerRed} />
            <Text style={styles.warnText}>이 약과 함께 드실 때 확인이 필요한 조합 {warnCount}건</Text>
            <ChevronRight size={22} color={colors.dangerRed} />
          </Pressable>
        ) : null}

        {/* 복약 일정 — 시간대마다 [수정]을 눈에 보이게 둔다 (QA 2026-08-20).
            스와이프처럼 숨겨진 조작 대신, 고칠 대상 바로 옆에 버튼을 붙인다. */}
        <Text style={styles.section}>복약 일정</Text>
        <View style={styles.card}>
          {(doses.length > 0 ? doses : [sched]).map((d, i) => (
            <View key={d.id} style={[styles.doseRow, i > 0 && styles.doseDivider]}>
              <Clock size={22} color={colors.primaryBlue} />
              <View style={styles.doseTextWrap}>
                <Text style={styles.doseTime}>{describeDoseTime(d)}</Text>
                <Text style={styles.doseRepeat}>{describeDoseRepeat(d)}</Text>
              </View>
              <Pressable
                onPress={() => nav.navigate("ButtonRegister", { editId: d.id })}
                style={({ pressed }) => [styles.editBtn, pressed && { opacity: 0.9 }]}
                accessibilityRole="button"
                accessibilityLabel={`${describeDoseTime(d)} 복약 일정 수정`}
              >
                <Pencil size={18} color={colors.white} />
                <Text style={styles.editText}>수정</Text>
              </Pressable>
            </View>
          ))}
        </View>

        {/* 구분 — 자동 분류가 안 되는 약은 사용자가 직접 고른다 (회의 결정) */}
        <Text style={styles.section}>약 구분</Text>
        <View style={styles.kindRow}>
          {MED_KINDS.map((k) => (
            <Pressable
              key={k}
              onPress={() => { void chooseKind(k); }}
              style={[styles.kindChip, kind === k && styles.kindChipOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: kind === k }}
            >
              <Text style={[styles.kindText, kind === k && styles.kindTextOn]}>{k}</Text>
            </Pressable>
          ))}
        </View>
        {kind === null ? <Text style={styles.hint}>아직 정해지지 않았어요. 눌러서 골라 주세요.</Text> : null}

        {/* 약 설명 */}
        <Text style={styles.section}>이 약은 어떤 약인가요</Text>
        <View style={styles.card}>
          {infoLoading ? (
            <View style={styles.infoLoading}>
              <ActivityIndicator color={colors.primaryBlue} />
              <Text style={styles.infoLoadingText}>약 정보를 찾고 있어요…</Text>
            </View>
          ) : info ? (
            <Text style={styles.infoText}>{info}</Text>
          ) : (
            <Text style={styles.infoEmpty}>
              이 약의 설명을 찾지 못했어요.{"\n"}약사나 의사에게 확인해 주세요.
            </Text>
          )}
        </View>

        {/* 약사 확인 안내 — "약사에게 물어보기" 버튼 대신 문구로 (회의 결정) */}
        <View style={styles.notice}>
          <Stethoscope size={22} color={colors.primaryNavy} />
          <Text style={styles.noticeText}>
            이 앱의 설명은 참고용이에요. 약을 바꾸거나 끊기 전에는{" "}
            <Text style={styles.noticeStrong}>약사나 의사에게 꼭 확인하세요.</Text>
          </Text>
        </View>

        <Pressable
          onPress={confirmDelete}
          style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
        >
          <Trash2 size={20} color={colors.dangerRed} />
          <Text style={styles.deleteText}>이 약 삭제</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  c: { padding: spacing.md },
  loading: { textAlign: "center", fontSize: fontSizes.body, color: colors.textSecondary, marginTop: spacing.lg, lineHeight: 27 },
  loadFailed: { padding: spacing.lg, gap: spacing.md },
  hero: {
    minHeight: 150, backgroundColor: colors.coralSoft, borderColor: colors.border, borderWidth: 1,
    borderRadius: radii.card, padding: spacing.md, justifyContent: "center", overflow: "hidden",
  },
  heroCopy: { width: "60%", zIndex: 1 },
  heroLabel: { flexDirection: "row", alignItems: "center", gap: 6 },
  heroLabelText: { fontSize: 16, fontWeight: "800", color: colors.primaryBlue },
  heroArt: { position: "absolute", width: 190, height: 138, right: -32, bottom: -4 },
  name: { fontSize: 28, lineHeight: 36, fontWeight: "800", color: colors.primaryNavy, marginTop: spacing.sm },
  time: { fontSize: 18, color: colors.textSecondary, marginTop: spacing.xs },
  warn: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.dangerSoft, borderColor: colors.dangerRed, borderWidth: 1,
    borderRadius: radii.card, padding: spacing.md, marginTop: spacing.md,
  },
  warnText: { flex: 1, fontSize: 19, fontWeight: "700", color: colors.dangerRed, lineHeight: 26 },
  section: { fontSize: 24, fontWeight: "800", color: colors.primaryNavy, marginTop: spacing.lg, marginBottom: spacing.sm },
  kindRow: { flexDirection: "row", gap: spacing.sm },
  kindChip: {
    flex: 1, minHeight: minTouch, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.cardBg, borderColor: colors.border, borderWidth: 1,
    borderRadius: radii.button,
  },
  kindChipOn: { backgroundColor: colors.primaryBlue, borderColor: colors.primaryBlue },
  kindText: { fontSize: 20, fontWeight: "700", color: colors.text },
  kindTextOn: { color: colors.white },
  hint: { fontSize: fontSizes.body, color: colors.textSecondary, marginTop: spacing.sm },
  card: {
    backgroundColor: colors.cardBg, borderColor: colors.border, borderWidth: 1,
    borderRadius: radii.card, padding: spacing.md,
  },
  doseRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    paddingVertical: spacing.sm, minHeight: minTouch,
  },
  doseDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  doseTextWrap: { flex: 1 },
  doseTime: { fontSize: 21, fontWeight: "800", color: colors.text },
  doseRepeat: { fontSize: fontSizes.body, color: colors.textSecondary, marginTop: 2 },
  editBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    minHeight: 48, paddingHorizontal: 18, borderRadius: radii.button,
    backgroundColor: colors.primaryBlue,
  },
  editText: { fontSize: fontSizes.body, fontWeight: "800", color: colors.white },
  infoText: { fontSize: 19, color: colors.text, lineHeight: 30 },
  infoEmpty: { fontSize: 19, color: colors.textSecondary, lineHeight: 30 },
  infoLoading: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  infoLoadingText: { fontSize: fontSizes.body, color: colors.textSecondary },
  notice: {
    flexDirection: "row", gap: spacing.sm, alignItems: "flex-start",
    backgroundColor: colors.lightBlueBg, borderRadius: radii.card,
    padding: spacing.md, marginTop: spacing.md,
  },
  noticeText: { flex: 1, fontSize: 19, color: colors.primaryNavy, lineHeight: 28 },
  noticeStrong: { fontWeight: "800" },
  deleteBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    minHeight: minTouch, borderRadius: radii.button, marginTop: spacing.lg,
    backgroundColor: colors.cardBg, borderColor: colors.dangerRed, borderWidth: 1,
  },
  deleteText: { fontSize: 20, fontWeight: "700", color: colors.dangerRed },
});
