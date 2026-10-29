import React, { useEffect, useRef, useState } from "react";
import { View, Text, ScrollView, StyleSheet, Pressable, Alert, Modal, useWindowDimensions } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Bell, Check, ChevronLeft } from "lucide-react-native";
import { BigButton } from "../components/BigButton";
import { supabase } from "../lib/supabase";
import { getPatientId } from "../lib/storage";
import { ensurePermission, scheduleReminders, warnNotificationsOff } from "../lib/notifications";
import { ensureStrongAlarmReady } from "../lib/alarmPermissions";
import { DISCLAIMER } from "../lib/voiceScript";
import { Slot, SLOTS } from "../lib/voiceParse";
import { slotLabel } from "../lib/timeOfDay";
import {
  AlarmSetup, initialSetup, medSlotsOf, toggleMedSlot, pickCount, chosenTimes, canFinish, showsUnslottedNote,
  medicinesAt, bumpSlotTime, bannerText, scheduleRows, ampm,
} from "../lib/voiceGuideFlow";
import { logGuideEvent } from "../lib/analytics";
import { trackApp } from "../lib/appStats";
import { colors, fontSizes, spacing, radii, shadows } from "../theme/tokens";

// 복용 알람 설정 — 한 화면 (회의 2026-09-03·09-12: 4단계 → 1단계).
//
// 1분 점검 결과에서 오면(Case A) 방금 점검한 약 이름을 받아 약마다 시간대를 고르고 그 이름
// 그대로 저장한다(회의 2026-09-06·09-12). 알람 물음에서 오면(Case C) 이름이 없으니 하루 횟수만
// 고르고 「아침 약」처럼 임시 이름으로 저장한다 — 실제 이름은 약장의 간편 등록에서.
// 시각은 시간대마다 하나를 함께 쓰고 「시간 바꾸기」 시트에서 ±30분으로 고친다.
// 안내는 글자로만, 대답은 화면 터치로만 받는다 — 소리·음성 인식 없음(2026-10-03).
// 저장은 「설정 완료」에서 한다 — "끝났어요"를 보여 준 뒤에 저장하면 거기서 앱을 닫은 사람은
// 알람이 없는데도 설정했다고 믿는다. 마치면 바로 홈이다(회의 2026-09-03).
// 결과 화면에서 로그인(가입)한 직후(from "login")에는 「나중에 설정할게요」로 알람을 건너뛰고 홈으로 갈 수 있다 —
// 로그인 전 결과 화면의 「나중에 할게요」를 없앴기 때문이다(회의 2026-10-11). saved면 맨 위에 저장했다고 알린다.

type Step = "setup" | "done";

export function VoiceGuideScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  // 들어올 때 받은 약 이름으로 모드를 한 번 정한다(정리·중복 제거는 initialSetup이).
  const [setup, setSetup] = useState<AlarmSetup>(() => initialSetup(route.params?.medicines));
  const [step, setStep] = useState<Step>("setup");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const fromLogin = route.params?.from === "login";
  const saved = route.params?.saved === true;

  // 두 번 눌러 저장이 겹치지 않게 하는 동기 가드(state는 버튼 문구·비활성용).
  const savingRef = useRef(false);
  // 저장 중에 화면을 떠났으면, 늦게 끝난 저장이 다른 화면 위에 Alert를 띄우지 않게.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  // 로그 (문서 §7): 어디서 막히는지 보려면 진행 방식이 필요하다.
  // buttonFallback — 한 화면이 된 뒤로는 설정에 든 탭 수(칩·횟수·±30분)를 센다.
  // tapInterrupt — 늘 0. 음성을 끊던 횟수였고 로그 스키마(tap_interrupt_count) 때문에 자리만 남겼다.
  const stats = useRef({ buttonFallback: 0, tapInterrupt: 0 });

  function toggle(medicine: string, slot: Slot) {
    stats.current.buttonFallback++;
    setSetup((s) => toggleMedSlot(s, medicine, slot));
  }

  function chooseCount(n: number) {
    stats.current.buttonFallback++;
    setSetup((s) => pickCount(s, n));
  }

  function bump(slot: Slot, deltaMin: number) {
    stats.current.buttonFallback++;
    setSetup((s) => bumpSlotTime(s, slot, deltaMin));
  }

  // 「설정 완료」 — 여기서 저장한다. 실패하면 이 화면에 남아 다시 누를 수 있다.
  async function finish(): Promise<void> {
    if (savingRef.current || !canFinish(setup)) return;
    savingRef.current = true;
    setSaving(true);
    const rows = scheduleRows(setup);
    try {
      const pid = await getPatientId();
      if (!pid) {
        if (mounted.current) Alert.alert("저장에 실패했어요", "내 정보를 찾지 못했어요. 앱을 다시 시작해 주세요.");
        return;
      }
      await ensureStrongAlarmReady();
      const granted = await ensurePermission();
      // 한 번에 넣는다 — 여러 행 insert는 한 문장이라 전부 들어가거나 하나도 안 들어간다.
      // 행마다 넣으면 중간에 실패한 뒤 시각을 고치거나 칸을 끄고 다시 눌러도 먼저 들어간 행이 그대로 남는다.
      const { data, error } = await supabase.from("schedules").insert(rows.map((r) => ({ patient_id: pid, ...r }))).select();
      if (error || !data) throw error ?? new Error("insert 실패");
      if (granted) {
        for (const d of data) {
          // 예약이 실패해도 행은 저장됐다 — 앱을 다시 열 때 resyncAllAlarms가 다시 예약한다.
          try {
            await scheduleReminders(d.id, d.medicine_name, d.hour, d.minute, d.repeat_days ?? [], d.time_of_day);
          } catch {}
        }
      }
      if (!mounted.current) return;
      void logGuideEvent({ step: "done", ...stats.current });
      trackApp("alarm_set");
      setSheetOpen(false);
      setStep("done");
      // 저장은 됐지만 알림 권한이 없으면 알람이 조용히 안 울린다 — 그 사실을 알린다.
      if (!granted) warnNotificationsOff();
    } catch {
      if (mounted.current) Alert.alert("저장에 실패했어요", "인터넷 연결을 확인하고 다시 시도해 주세요.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  // 회의 2026-10-06: 「나중에」를 없애고 뒤로 가면 앞 화면(결과·알람 물음)으로 돌아간다.
  // 거기서 「나중에 할게요」를 고르면 된다.
  function goBack() {
    if (sheetOpen) { setSheetOpen(false); return; }
    if (nav.canGoBack()) nav.goBack();
    else goHome();
  }

  // 저장은 이미 끝났다 — 홈으로 가기만 한다.
  function goHome() {
    nav.reset({ index: 0, routes: [{ name: "Tabs" }] });
  }

  // 「나중에 설정할게요」(로그인 직후에만) — 알람 없이 홈으로. reset은 beforeRemove가 그냥 통과시키므로
  // 「건너뜀」 로그는 여기서 한 번만 남긴다.
  function later() {
    if (savingRef.current) return;
    void logGuideEvent({ step: "skipped", ...stats.current });
    trackApp("alarm_skip");
    goHome();
  }

  // 화면을 떠나는 모든 길(헤더 뒤로·안드로이드 뒤로·iOS 스와이프)을 여기서 받는다.
  // 저장 중에는 떠나지 않는다 — 저장이 끝난 뒤 앞 화면에서 다시 설정하면 같은 알람이 두 벌 생긴다.
  // 완료 뒤에도 앞 화면으로 돌아가지 않고 홈으로 간다 — 같은 이유. 코드가 부르는 reset(홈으로)은 그대로 통과.
  useEffect(() => nav.addListener("beforeRemove", (e: any) => {
    if (e.data.action.type === "RESET") return;
    if (savingRef.current) { e.preventDefault(); return; }
    if (step === "done") { e.preventDefault(); goHome(); return; }
    void logGuideEvent({ step: "skipped", ...stats.current });
    trackApp("alarm_skip");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [nav, step]);
  // iOS 스와이프는 beforeRemove로 막히지 않아 제스처 자체를 끈다.
  useEffect(() => { nav.setOptions({ gestureEnabled: step === "setup" && !saving }); }, [nav, step, saving]);

  const byMedicine = setup.mode === "medicines";
  const times = chosenTimes(setup);

  return (
    // 상단 인셋은 ScrollView 바깥에. contentContainerStyle에 주면 스크롤할 때
    // 내용이 상태바 밑으로 올라와 겹친다.
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* 헤더 — 뒤로만 (한 화면이라 진행 표시는 없다). 완료 단계에선 숨긴다 —
          이미 저장했으니 되돌아가 다시 저장하면 같은 알람이 또 생긴다. */}
      {step === "setup" ? (
        <View style={styles.header}>
          <Pressable onPress={goBack} disabled={saving} hitSlop={12} style={styles.backBtn}
            accessibilityRole="button" accessibilityLabel="뒤로">
            <ChevronLeft size={26} color={colors.textSecondary} />
          </Pressable>
        </View>
      ) : null}

      <ScrollView contentContainerStyle={[styles.body, step === "done" && styles.bodyDone]}>
        {step === "setup" ? (
          <>
            {/* 결과 화면에서 가입한 직후 — 방금 점검 결과를 저장했다는 확인 */}
            {fromLogin && saved ? (
              <View style={styles.savedRow}>
                <Check size={20} color={colors.successGreen} />
                <Text style={styles.savedText}>분석 결과를 저장했어요</Text>
              </View>
            ) : null}
            <Text style={styles.title}>{byMedicine ? "각 약을 언제 드세요?" : "하루에 몇 번 드세요?"}</Text>
            <Text style={styles.sub}>
              {byMedicine ? `방금 점검한 ${setup.medicines.length}가지예요` : "약과 영양제를 드시는 횟수예요"}
            </Text>

            {/* Case A — 약마다 시간대 칩(여러 개). 미리 켜 둔 칸은 없다 */}
            {byMedicine ? (
              <View style={styles.medList}>
                {setup.medicines.map((m) => (
                  <View key={m} style={styles.medCard}>
                    <Text style={styles.medName}>{m}</Text>
                    <View style={styles.slotRow}>
                      {SLOTS.map((slot) => {
                        const on = medSlotsOf(setup, m).includes(slot);
                        return (
                          <Pressable key={slot} onPress={() => toggle(m, slot)} disabled={saving}
                            hitSlop={{ top: 6, bottom: 6, left: 3, right: 3 }}
                            accessibilityRole="button" accessibilityLabel={`${m} ${slotLabel(slot)}`}
                            accessibilityState={{ selected: on, disabled: saving }}
                            style={({ pressed }) => [styles.slotChip, on && styles.slotChipOn, pressed && styles.pressed]}>
                            <Text style={[styles.slotChipText, on && styles.slotChipTextOn]} numberOfLines={1} adjustsFontSizeToFit>
                              {slotLabel(slot)}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              // Case C — 하루 횟수 2x2. 시간대는 횟수에 맞춰 정해진다(defaultSlotsFor)
              <View style={styles.countGrid}>
                {[1, 2, 3, 4].map((n) => {
                  const on = setup.count === n;
                  return (
                    <Pressable key={n} onPress={() => chooseCount(n)} disabled={saving}
                      accessibilityRole="button" accessibilityState={{ selected: on, disabled: saving }}
                      style={({ pressed }) => [styles.countBtn, on && styles.countBtnOn, pressed && styles.pressed]}>
                      <Text style={[styles.countText, on && styles.countTextOn]}>{n === 4 ? "4번 이상" : `${n}번`}</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}

            {/* 배너를 버튼 바로 위로 민다(시안). 약이 많으면 목록과 함께 스크롤된다. */}
            <View style={styles.spacer} />

            {showsUnslottedNote(setup) ? (
              <Text style={styles.note}>시간을 고르지 않은 약은 알람을 맞추지 않아요</Text>
            ) : null}

            {/* 시각 요약 — 배너 전체를 누를 수 있게 해 「시간 바꾸기」를 크게 잡는다 */}
            {times.length > 0 ? (
              <Pressable onPress={() => setSheetOpen(true)} disabled={saving}
                accessibilityRole="button" accessibilityLabel={`${bannerText(setup)}. 시간 바꾸기`}
                style={({ pressed }) => [styles.banner, pressed && styles.pressed]}>
                <Bell size={22} color={colors.primaryBlue} />
                <View style={styles.bannerBody}>
                  <Text style={styles.bannerText}>{bannerText(setup)}</Text>
                  <Text style={styles.bannerLink}>시간 바꾸기 ›</Text>
                </View>
              </Pressable>
            ) : null}
          </>
        ) : (
          <>
            {/* 완료 — 회의 2026-09-03: 위험 분석을 다시 제안하지 않고 바로 홈으로 */}
            <View style={styles.doneCard}>
              <Check size={36} color={colors.successGreen} />
              <Text style={styles.doneTitle}>복용 알람 설정이 끝났어요</Text>
              {times.map((t) => (
                <View key={t.slot} style={styles.doneItem}>
                  <Text style={styles.summaryLine}>{`${slotLabel(t.slot)} · ${ampm(t.hour, t.minute)}`}</Text>
                  {byMedicine ? <Text style={styles.summaryMeds}>{medicinesAt(setup, t.slot).join(" · ")}</Text> : null}
                </View>
              ))}
            </View>

            {/* 옛 「카카오 연결하기」 카드는 회의 2026-10-08에 없앴다 — 로그인한 사람만 여기 온다. */}
          </>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: spacing.md + insets.bottom }]}>
        {step === "setup" ? (
          <>
            <BigButton label={saving ? "저장 중…" : "설정 완료"} onPress={() => { void finish(); }}
              disabled={saving || !canFinish(setup)} />
            {fromLogin ? <BigButton label="나중에 설정할게요" variant="secondary" onPress={later} disabled={saving} /> : null}
          </>
        ) : (
          <>
            <BigButton label="홈으로 가기" onPress={goHome} />
            <Text style={styles.disclaimer}>{DISCLAIMER}</Text>
          </>
        )}
      </View>

      {/* 시간 바꾸기 시트 — 고른 시간대마다 ±30분. 고친 시각은 시간대에 남는다(칩을 껐다 켜도) */}
      <Modal visible={sheetOpen} transparent animationType="slide" onRequestClose={() => setSheetOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setSheetOpen(false)} accessibilityLabel="닫기" />
        <View style={[styles.sheet, { paddingBottom: spacing.lg + insets.bottom }]}>
          <View style={styles.grab} />
          <Text style={styles.sheetTitle}>알림 시간 바꾸기</Text>
          {/* 시간대 이름은 윗줄에 — 한 줄에 넣으면 큰 글씨 설정에서 가운데 시각이 먼저 줄어든다.
              시간대가 넷이고 글씨가 크면 길어지므로 목록만 스크롤하고 「완료」는 늘 보이게 둔다. */}
          <ScrollView style={{ maxHeight: windowHeight * 0.55 }} bounces={false}>
            {times.map((t) => (
              <View key={t.slot} style={styles.sheetRow}>
                <Text style={styles.sheetSlot}>{slotLabel(t.slot)}</Text>
                <View style={styles.sheetCtrl}>
                  <Pressable onPress={() => bump(t.slot, -30)} hitSlop={6}
                    accessibilityRole="button" accessibilityLabel={`${slotLabel(t.slot)} 30분 일찍`}
                    style={({ pressed }) => [styles.bump, pressed && styles.pressed]}>
                    <Text style={styles.bumpText} numberOfLines={1}>−30분</Text>
                  </Pressable>
                  <Text style={styles.sheetTime} numberOfLines={1} adjustsFontSizeToFit accessibilityLiveRegion="polite">
                    {ampm(t.hour, t.minute)}
                  </Text>
                  <Pressable onPress={() => bump(t.slot, 30)} hitSlop={6}
                    accessibilityRole="button" accessibilityLabel={`${slotLabel(t.slot)} 30분 늦게`}
                    style={({ pressed }) => [styles.bump, pressed && styles.pressed]}>
                    <Text style={styles.bumpText} numberOfLines={1}>+30분</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </ScrollView>
          <View style={styles.sheetDone}>
            <BigButton label="완료" onPress={() => setSheetOpen(false)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    height: 60, paddingHorizontal: spacing.md,
  },
  backBtn: { width: 72, height: 44, justifyContent: "center" },
  // flexGrow — 내용이 짧으면 spacer가 늘어나 배너를 아래로 민다
  body: { flexGrow: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  bodyDone: { paddingTop: spacing.lg, gap: spacing.md },
  savedRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginBottom: spacing.sm },
  savedText: { fontSize: fontSizes.body, fontWeight: "700", color: colors.successGreen },
  title: { fontSize: 27, lineHeight: 38, fontWeight: "800", color: colors.primaryNavy, letterSpacing: -0.7 },
  sub: { marginTop: 6, fontSize: fontSizes.body, lineHeight: 27, fontWeight: "600", color: colors.textSecondary, letterSpacing: -0.3 },

  medList: { marginTop: spacing.md, gap: 10 },
  medCard: {
    backgroundColor: colors.cardBg, borderColor: colors.border, borderWidth: 1, borderRadius: radii.card,
    paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14, gap: spacing.sm,
  },
  medName: { fontSize: fontSizes.body, lineHeight: 26, fontWeight: "800", color: colors.text },
  slotRow: { flexDirection: "row", gap: 6 },
  // 좁은 화면·큰 글씨에서도 「자기 전」이 한 줄에 들어가게 글자를 줄여 맞춘다(adjustsFontSizeToFit)
  slotChip: {
    flex: 1, minHeight: 48, paddingHorizontal: 4, borderRadius: radii.pill,
    alignItems: "center", justifyContent: "center",
    backgroundColor: colors.surfaceRaised, borderWidth: 1.5, borderColor: colors.border,
  },
  slotChipOn: { backgroundColor: colors.primarySoft, borderColor: colors.primaryBlue },
  slotChipText: { fontSize: fontSizes.body, fontWeight: "700", color: colors.textSecondary },
  slotChipTextOn: { color: colors.primaryBlue },

  countGrid: { marginTop: 18, flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: spacing.sm },
  countBtn: {
    width: "48.5%", minHeight: 88, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.cardBg, borderColor: colors.border, borderWidth: 1.5, borderRadius: radii.card,
  },
  countBtnOn: { backgroundColor: colors.primarySoft, borderColor: colors.primaryBlue },
  countText: { fontSize: 26, fontWeight: "800", color: colors.primaryNavy },
  countTextOn: { color: colors.primaryBlue },

  spacer: { flexGrow: 1, minHeight: spacing.md },
  note: { fontSize: fontSizes.body, lineHeight: 26, fontWeight: "600", color: colors.textSecondary, marginBottom: spacing.sm },
  banner: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: colors.lightBlueBg, borderColor: colors.border, borderWidth: 1, borderRadius: radii.card,
    paddingVertical: 14, paddingHorizontal: spacing.md,
  },
  bannerBody: { flex: 1 },
  bannerText: { fontSize: fontSizes.body, lineHeight: 26, fontWeight: "700", color: colors.primaryNavy },
  bannerLink: { marginTop: 6, fontSize: fontSizes.body, fontWeight: "800", color: colors.primaryBlue },
  pressed: { opacity: 0.85 },

  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, backgroundColor: colors.canvas },

  doneCard: {
    alignItems: "center", gap: 6,
    backgroundColor: colors.cardBg, borderColor: colors.border, borderWidth: 1,
    borderRadius: radii.card, padding: spacing.lg,
  },
  doneTitle: { fontSize: 24, fontWeight: "800", color: colors.primaryNavy, marginVertical: spacing.xs },
  doneItem: { alignItems: "center" },
  summaryLine: { fontSize: 21, color: colors.text },
  summaryMeds: { fontSize: fontSizes.body, lineHeight: 26, color: colors.textSecondary, textAlign: "center" },
  disclaimer: { fontSize: 16, color: colors.textSecondary, textAlign: "center", lineHeight: 24 },

  backdrop: { flex: 1, backgroundColor: colors.overlayStrong },
  sheet: {
    backgroundColor: colors.surfaceRaised, borderTopLeftRadius: radii.hero, borderTopRightRadius: radii.hero,
    paddingHorizontal: 20, paddingTop: 10, ...shadows.floating,
  },
  grab: { alignSelf: "center", width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: 14 },
  sheetTitle: { fontSize: 22, lineHeight: 32, fontWeight: "800", color: colors.primaryNavy, marginBottom: spacing.xs },
  sheetRow: { paddingVertical: 12, gap: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.canvasMuted },
  sheetSlot: { fontSize: fontSizes.body, fontWeight: "800", color: colors.text },
  // 세 칸을 고르게 나눈다(시각 칸이 조금 넓게) — 글씨가 커져도 버튼이 시각 자리를 빼앗지 않게
  sheetCtrl: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  sheetTime: { flex: 1.3, textAlign: "center", fontSize: 20, fontWeight: "800", color: colors.primaryNavy },
  bump: {
    flex: 1, minHeight: 48, paddingHorizontal: 6, borderRadius: radii.pill,
    alignItems: "center", justifyContent: "center",
    backgroundColor: colors.lightBlueBg, borderWidth: 1.5, borderColor: colors.border,
  },
  bumpText: { fontSize: fontSizes.body, fontWeight: "800", color: colors.primaryBlue },
  sheetDone: { marginTop: 14 },
});
