import React, { useEffect, useRef, useState } from "react";
import { View, Text, TextInput, StyleSheet, Pressable, ScrollView, Alert, KeyboardAvoidingView } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as WebBrowser from "expo-web-browser";
import { Check, ChevronLeft } from "lucide-react-native";
import { BigButton } from "../components/BigButton";
import { currentUser, displayNameFrom } from "../lib/auth";
import { NAME_MAX } from "../lib/authHelpers";
import { adoptPatient, createMyPatient, recordMyConsent, Consent } from "../lib/account";
import { continueAfterLogin } from "../navigation/afterLogin";
import { trackApp } from "../lib/appStats";
import type { LoginPurpose } from "../navigation/types";
import { colors, fontSizes, spacing, radii, minTouch, shadows } from "../theme/tokens";

// 처음 로그인한 사람에게 한 번만 — 이름과 동의를 받고 환자 행을 만든다(회의 2026-10-08).
// 민감정보(건강정보)는 개인정보 수집·이용과 따로 동의를 받는다(개인정보 보호법 제23조).
// ※ 아래 동의 문구·항목은 법률 검토 전 초안이다. 문구를 고치면 CONSENT_VERSION을 올린다.

const CONSENT_VERSION = "2026-10-08";
const TERMS_URL = "https://modubokyak.com/terms/";

type Key = "terms" | "privacy" | "sensitive";

export function ConsentScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const purpose: LoginPurpose = route.params?.purpose ?? "skip";
  const medicines: string[] | undefined = route.params?.medicines;
  const appleFullName: string | null = route.params?.appleFullName ?? null;
  const existingPatientId: string | undefined = route.params?.existingPatientId;

  const [name, setName] = useState("");
  const [agreed, setAgreed] = useState<Record<Key, boolean>>({ terms: false, privacy: false, sensitive: false });
  // 두 번 눌러 환자가 두 명 만들어지지 않게 — ref는 동기 가드, state는 버튼 문구용.
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const typed = useRef(false);

  // 이름 칸 미리 채우기 — 카카오 닉네임 또는 Apple이 준 이름. 그새 사용자가 적었으면 덮지 않는다.
  useEffect(() => {
    let alive = true;
    void currentUser().then((u) => {
      const n = displayNameFrom(u, appleFullName);
      if (alive && n && !typed.current) setName(n);
    });
    return () => { alive = false; };
  }, [appleFullName]);

  const all = agreed.terms && agreed.privacy && agreed.sensitive;
  const canStart = name.trim().length > 0 && all && !saving;

  const toggle = (k: Key) => setAgreed((a) => ({ ...a, [k]: !a[k] }));
  const toggleAll = () => setAgreed({ terms: !all, privacy: !all, sensitive: !all });

  function openTerms() {
    WebBrowser.openBrowserAsync(TERMS_URL).catch(() => {
      Alert.alert("이용약관", "약관 화면을 열지 못했어요. 인터넷 연결을 확인해 주세요.");
    });
  }
  const openPrivacy = () => nav.navigate("Privacy", { from: "consent" });

  async function start(): Promise<void> {
    if (savingRef.current || !canStart) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const consent: Consent = { version: CONSENT_VERSION, terms: true, privacy: true, sensitive: true, agreedAt: new Date().toISOString() };
      // 옛 빌드에서 이어 붙은 계정은 환자 행이 이미 있다 — 새로 만들지 않고 동의만 남긴다(약·기록 그대로).
      const mine = existingPatientId
        ? await recordMyConsent(existingPatientId, name.trim(), consent)
        : await createMyPatient(name.trim(), consent);
      await adoptPatient(mine);
      // 동의를 서버에 남기고 환자를 앉힌 뒤 — 실패하면 여기까지 오지 않아 세지 않는다.
      trackApp("signup_done", { purpose, isNew: !existingPatientId });
      await continueAfterLogin(nav, { purpose, medicines, isNew: !existingPatientId });
    } catch (e) {
      console.warn("Consent: 시작 실패", (e as Error)?.message ?? e);
      Alert.alert("시작하지 못했어요", "인터넷 연결을 확인하고 다시 시도해 주세요.");
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    // Expo 54는 Android도 edge-to-edge라 키보드가 떠도 창이 안 줄어든다 — 두 플랫폼 모두 padding으로 밀어 올린다.
    <KeyboardAvoidingView style={[styles.screen, { paddingTop: insets.top }]} behavior="padding">
      <View style={styles.header}>
        <Pressable onPress={() => { if (!savingRef.current) nav.goBack(); }} disabled={saving} hitSlop={12} style={styles.backBtn}
          accessibilityRole="button" accessibilityLabel="뒤로">
          <ChevronLeft size={26} color={colors.textSecondary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.c} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <Text style={styles.title}>시작하기 전에{"\n"}확인해 주세요</Text>
        <Text style={styles.sub}>처음 한 번만 여쭤봐요.</Text>

        <View style={styles.card}>
          <Text style={styles.question}>어떻게 불러드릴까요?</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={(t) => { typed.current = true; setName(t); }}
            placeholder="이름을 적어 주세요"
            placeholderTextColor={colors.textSecondary}
            maxLength={NAME_MAX}
            returnKeyType="done"
            accessibilityLabel="이름"
          />
        </View>

        <View style={styles.card}>
          <CheckRow label="전체 동의" checked={all} onPress={toggleAll} strong />
          <View style={styles.divider} />
          <CheckRow label="[필수] 이용약관" checked={agreed.terms} onPress={() => toggle("terms")} onView={openTerms} />
          <CheckRow label="[필수] 개인정보 수집·이용" checked={agreed.privacy} onPress={() => toggle("privacy")} onView={openPrivacy} />
          <CheckRow label="[필수] 민감정보(건강정보) 처리" checked={agreed.sensitive} onPress={() => toggle("sensitive")} onView={openPrivacy} />
          {/* 민감정보는 무엇을·왜·거부하면 어떻게 되는지를 동의 칸 바로 아래에 적는다 */}
          <View style={styles.explain}>
            <Text style={styles.explainText}>· 받는 정보: 복용 중인 약·영양제 이름, 연령대, 임신·수유·신장질환·간질환 해당 여부</Text>
            <Text style={styles.explainText}>· 쓰는 곳: 함께 먹어도 되는 조합인지 확인하고, 복약 알람을 보내 드리는 데에만 써요. 계정을 삭제하면 바로 지워요.</Text>
            <Text style={styles.explainText}>· 동의하지 않으시면 점검 결과를 저장할 수 없어요.</Text>
          </View>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: spacing.md + insets.bottom }]}>
        <BigButton label={saving ? "시작하는 중…" : "동의하고 시작하기"} onPress={() => { void start(); }} disabled={!canStart} showArrow />
      </View>
    </KeyboardAvoidingView>
  );
}

function CheckRow({ label, checked, onPress, onView, strong = false }: {
  label: string; checked: boolean; onPress: () => void; onView?: () => void; strong?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Pressable onPress={onPress} style={({ pressed }) => [styles.rowMain, pressed && { opacity: 0.85 }]}
        accessibilityRole="checkbox" accessibilityState={{ checked }} accessibilityLabel={label}>
        <View style={[styles.box, checked && styles.boxOn]}>
          {checked ? <Check size={20} strokeWidth={3.2} color={colors.white} /> : null}
        </View>
        <Text style={[styles.rowLabel, strong && styles.rowLabelStrong]}>{label}</Text>
      </Pressable>
      {onView ? (
        <Pressable onPress={onView} hitSlop={6} style={styles.viewBtn} accessibilityRole="link" accessibilityLabel={`${label} 보기`}>
          <Text style={styles.viewText}>보기</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  header: { height: 56, flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.sm },
  backBtn: { width: minTouch, height: minTouch, alignItems: "center", justifyContent: "center" },
  c: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.md },
  title: { fontSize: 28, lineHeight: 39, fontWeight: "800", color: colors.primaryNavy, letterSpacing: -0.6 },
  sub: { fontSize: fontSizes.body, lineHeight: 26, color: colors.textSecondary, marginTop: -spacing.xs },
  card: {
    backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderWidth: 1,
    borderRadius: radii.card, padding: spacing.md, ...shadows.card,
  },
  question: { fontSize: fontSizes.emphasis, fontWeight: "800", color: colors.primaryNavy, marginBottom: spacing.sm },
  input: {
    backgroundColor: colors.cardBg, borderColor: colors.border, borderWidth: 1.5,
    borderRadius: radii.button, fontSize: fontSizes.emphasis, padding: 14, minHeight: minTouch, color: colors.text,
  },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.xs },
  row: { flexDirection: "row", alignItems: "center", minHeight: minTouch },
  rowMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: minTouch },
  box: {
    width: 30, height: 30, borderRadius: 8, borderWidth: 2, borderColor: colors.border,
    backgroundColor: colors.cardBg, alignItems: "center", justifyContent: "center",
  },
  boxOn: { backgroundColor: colors.primaryBlue, borderColor: colors.primaryBlue },
  rowLabel: { flex: 1, fontSize: fontSizes.body, lineHeight: 25, fontWeight: "600", color: colors.text },
  rowLabelStrong: { fontSize: 20, fontWeight: "800", color: colors.primaryNavy },
  viewBtn: { minWidth: minTouch, minHeight: minTouch, alignItems: "center", justifyContent: "center" },
  viewText: { fontSize: fontSizes.body, fontWeight: "700", color: colors.primaryBlue, textDecorationLine: "underline" },
  explain: { backgroundColor: colors.lightBlueBg, borderRadius: radii.small, padding: spacing.sm + 4, gap: 6, marginTop: spacing.xs },
  explainText: { fontSize: fontSizes.body, lineHeight: 26, color: colors.text },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
});
