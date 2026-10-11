import React, { useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, Alert } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { Trash2 } from "lucide-react-native";
import { ScreenHeader } from "../components/ScreenHeader";
import { IllustrationBanner } from "../components/IllustrationBanner";
import { deleteMyAccount } from "../lib/account";
import { colors, fontSizes, radii, spacing, minTouch } from "../theme/tokens";

const PRIVACY_ART = require("../../assets/illustrations/privacy-lock.png");

type Section = { title: string; body: string[] };

// 실제 수집·이용 범위를 그대로 적는다. 앱이 하지 않는 일(제3자 제공, 광고 등)은
// 하지 않는다고 명시한다. 웹 방침 https://modubokyak.com/privacy/ (modubokyak-com/web 저장소,
// 원본은 store-assets/common/개인정보처리방침.html)과 같은 내용이어야 한다(스토어 심사에서
// 앱 안 문구와 웹 방침이 어긋나면 반려된다) — 한쪽을 고치면 다른 쪽도 고친다.
// 2026-10-08 간편 로그인 반영(로그인 정보·동의 기록·Apple·계정 삭제) — 법률 검토 전 초안.
// 시행일은 새 빌드 출시일로 바꿀 것.
const EFFECTIVE_DATE = "2026년 10월 8일";

const SECTIONS: Section[] = [
  {
    title: "개인정보 처리자",
    body: [
      "모두의 복약을 운영하는 법인 안팜이 이 앱의 개인정보를 처리합니다.",
      "문의: 앱 스토어 페이지의 지원 이메일",
    ],
  },
  {
    title: "1. 수집하는 정보",
    body: [
      "· 이름 (처음 로그인할 때 직접 입력)",
      "· 복약 일정 (약 이름, 시간대, 복용 시각, 반복 요일, 1회 복용량)",
      "· 복약 응답 기록 (복용 · 미루기 · 건너뜀과 그 시각)",
      "· 1분 복용 점검에 입력한 내용과 점검 결과",
      "   — 영양제·약 이름, 연령대, 해당 항목(임신·수유 중 / 신장질환 / 간질환)",
      "   — 해당 항목은 건강에 관한 정보(민감정보)입니다. 따로 동의를 받고, 점검 결과를 보여 드리고 저장하는 데에만 씁니다.",
      "   — 로그인하기 전에 한 점검은 판정에만 쓰고 서버에 저장하지 않습니다.",
      "· 로그인 정보: 카카오는 회원번호·닉네임, Apple은 회원 식별값과 사용자가 허용한 이름·이메일",
      "   — 닉네임·이름은 처음 이름 칸을 채우는 데에만 씁니다.",
      "· 동의 기록 (동의한 항목과 시각)",
      "· 앱 사용 기록 (알람이 울린 시각, 응답, 알람 설정을 마쳤는지 — 통계용)",
      "",
      "생년월일, 성별, 전화번호, 위치 정보는 받지 않습니다.",
      "마이크를 쓰지 않으며, 목소리를 녹음하거나 전송하지 않습니다.",
    ],
  },
  {
    title: "2. 이용 목적",
    body: [
      "복약 알람을 정확한 시각에 보내 드리고, 복약 현황을 보여 드리고,",
      "1분 복용 점검 결과를 보여 드리는 데에만 사용합니다.",
      "앱 사용 기록은 알람이 잘 울리는지 살피는 통계에만 씁니다.",
      "광고나 마케팅에는 사용하지 않습니다.",
    ],
  },
  {
    title: "3. 사진의 처리",
    body: [
      "약봉투 사진으로 등록하실 때에만, 사진의 글자를 읽기 위해 그 사진이 OpenAI의",
      "이미지 인식 서비스로 전송됩니다. 전송된 사진은 이 앱의 서버에 저장하지 않으며,",
      "읽어낸 결과로 만들어진 복약 일정만 저장됩니다.",
    ],
  },
  {
    title: "4. 처리 위탁",
    body: [
      "아래 회사에 정보 처리를 맡깁니다. 그 밖의 누구에게도 제공하거나 판매하지 않습니다.",
      "· Supabase — 서버와 데이터베이스 운영",
      "· OpenAI — 약봉투 사진의 글자 인식",
      "· 카카오 — 카카오 로그인",
      "· Apple — Apple로 로그인 (iPhone)",
    ],
  },
  {
    title: "5. 보관과 파기",
    body: [
      "정보는 서비스를 이용하시는 동안 보관합니다.",
      "아래 '모든 데이터 삭제'(또는 계정 관리의 '계정 삭제')를 누르시거나 삭제를 요청하시면",
      "이름, 일정, 기록, 점검 결과, 로그인 계정 정보, 앱 사용 기록이 즉시 삭제되며, 복구할 수 없습니다.",
      "앱 사용 기록은 통계 목적으로만 쓰고, 그 밖의 용도로는 쓰지 않습니다.",
    ],
  },
  {
    title: "6. 삭제 방법",
    body: [
      "· 앱 안에서: 더보기 → 개인정보 설정 → 모든 데이터 삭제",
      "   (또는 더보기 → 계정 관리 → 계정 삭제)",
      "· 이메일로: 앱 스토어 페이지의 지원 연락처로 요청해 주세요.",
      "앱을 지우기 전에 먼저 삭제 버튼을 눌러 주세요. 앱만 지우면 서버의 정보는 남습니다.",
    ],
  },
  {
    title: "7. 앱이 사용하는 권한",
    body: [
      "· 알림 · 알람 및 리마인더 — 복약 알람을 정확한 시각에 보내기 위해",
      "· 카메라 · 사진 — 약봉투를 촬영해 복약 정보를 읽기 위해",
      "각 권한은 위에 적은 용도 외에는 사용하지 않습니다.",
    ],
  },
  {
    title: "8. 시험 서비스 안내",
    body: [
      "이 앱은 시험 운영 단계의 서비스입니다. 의료기기가 아니며 진단·처방을",
      "대신하지 않습니다. 약에 대한 상담은 의사나 약사와 상의해 주세요.",
    ],
  },
  {
    title: "9. 시행일",
    body: [`이 방침은 ${EFFECTIVE_DATE}부터 시행합니다.`],
  },
];

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
            모두의 복약은 복약 관리를 위해 꼭 필요한 정보만 모으고, 암호화된 연결로 전송하고 보관합니다.
          </Text>
          {SECTIONS.map((s) => (
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
