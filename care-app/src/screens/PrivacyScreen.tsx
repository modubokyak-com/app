import React, { useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, Alert } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { Trash2 } from "lucide-react-native";
import { ScreenHeader } from "../components/ScreenHeader";
import { IllustrationBanner } from "../components/IllustrationBanner";
import { deleteMyAccount } from "../lib/account";
import { PRIVACY_POLICY_INTRO, PRIVACY_POLICY_SECTIONS } from "../lib/privacyPolicy";
import { colors, fontSizes, radii, spacing, minTouch } from "../theme/tokens";

const PRIVACY_ART = require("../../assets/illustrations/privacy-lock.png");

// 실제 수집·이용 범위를 그대로 적는다(문구는 lib/privacyPolicy.ts). 앱이 하지 않는 일(제3자 제공, 광고 등)은
// 하지 않는다고 명시한다. 공개 웹 방침 https://modubokyak.com/privacy/ 은 별도 저장소 modubokyak-com/web 에 있다
// (원본은 store-assets/common/개인정보처리방침.html) — 앱 안 문구와 같은 내용이어야 한다(스토어 심사에서
// 어긋나면 반려된다). 한쪽을 고치면 다른 쪽도 고친다. 2026-10-15 이메일 로그인 항목을 앱 쪽에 더했으니 웹도 맞출 것.
export function PrivacyScreen() {
  const nav = useNavigation<any>();
  // 동의 화면의 「보기」로 열었으면 아직 가입 전이라 지울 데이터가 없다 — 삭제 버튼을 숨긴다.
  const fromConsent = useRoute<any>().params?.from === "consent";
  const [deleting, setDeleting] = useState(false);

  // 계정 관리의 「계정 삭제」와 같은 길 — 로그인 계정을 지우면 환자·일정·기록·알람 로그·점검 결과가
  // 서버에서 함께 지워지고(cascade), 기기의 알람·저장값·점검 초안·세션도 정리된다(account.ts).
  async function deleteEverything(): Promise<void> {
    setDeleting(true);
    try {
      await deleteMyAccount();
      nav.reset({ index: 0, routes: [{ name: "Intro", params: { slide: "cta" } }] });
    } catch {
      setDeleting(false);
      Alert.alert(
        "삭제하지 못했어요",
        "인터넷 연결을 확인하고 다시 시도해 주세요."
      );
    }
  }

  function confirmDelete(): void {
    Alert.alert(
      "모든 데이터를 삭제할까요?",
      "계정과 함께 등록하신 약, 알람, 복약 기록, 점검 결과가 모두 지워지고 처음 화면으로 돌아가요. 되돌릴 수 없습니다.",
      [
        { text: "취소", style: "cancel" },
        { text: "삭제", style: "destructive", onPress: () => { void deleteEverything(); } },
      ]
    );
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader title="개인정보 설정" />
      <ScrollView contentContainerStyle={styles.content}>
        <IllustrationBanner source={PRIVACY_ART} tone="cream" height={170} />
        <View style={styles.card}>
          <Text style={styles.docTitle}>개인정보처리방침</Text>
          <Text style={styles.intro}>
            {PRIVACY_POLICY_INTRO}
          </Text>
          {PRIVACY_POLICY_SECTIONS.map((s) => (
            <View key={s.title} style={styles.section}>
              <Text style={styles.sectionTitle}>{s.title}</Text>
              {s.body.map((line, i) => (
                <Text key={i} style={styles.sectionBody}>{line}</Text>
              ))}
            </View>
          ))}
        </View>

        {fromConsent ? null : (
          <>
            <Pressable
              onPress={confirmDelete}
              disabled={deleting}
              style={({ pressed }) => [styles.deleteBtn, (pressed || deleting) && { opacity: 0.8 }]}
            >
              <Trash2 size={20} color="#fff" />
              <Text style={styles.deleteBtnText}>
                {deleting ? "삭제 중…" : "모든 데이터 삭제"}
              </Text>
            </Pressable>
            <Text style={styles.deleteNote}>
              계정과 서버에 저장된 정보가 모두 삭제되고 처음 화면으로 돌아가요.
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  card: {
    backgroundColor: colors.cardBg, borderColor: colors.border, borderWidth: 1,
    borderRadius: radii.card, padding: spacing.md,
  },
  docTitle: { fontSize: fontSizes.emphasis, fontWeight: "800", color: colors.primaryNavy },
  intro: {
    fontSize: fontSizes.body, color: colors.textSecondary,
    marginTop: spacing.sm, lineHeight: 26,
  },
  section: { marginTop: spacing.lg },
  sectionTitle: {
    fontSize: fontSizes.body, fontWeight: "800", color: colors.primaryNavy,
    marginBottom: spacing.xs,
  },
  sectionBody: { fontSize: fontSizes.body, color: colors.text, lineHeight: 28 },
  deleteBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    minHeight: minTouch, borderRadius: radii.button, marginTop: spacing.lg,
    backgroundColor: colors.dangerRed,
  },
  deleteBtnText: { fontSize: fontSizes.emphasis, fontWeight: "700", color: "#fff" },
  deleteNote: {
    fontSize: fontSizes.body, color: colors.textSecondary,
    textAlign: "center", marginTop: spacing.sm,
  },
});
