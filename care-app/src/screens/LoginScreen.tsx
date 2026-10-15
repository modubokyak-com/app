import React from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Platform } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft } from "lucide-react-native";
import { Logo } from "../components/Logo";
import { SignInButtons } from "../components/SignInButtons";
import { useSignIn } from "../navigation/useSignIn";
import type { LoginPurpose } from "../navigation/types";
import { colors, fontSizes, spacing, radii, minTouch, shadows } from "../theme/tokens";

const LOGO_CARD = 104;
const LOGO_SIZE = 80;
const IOS = Platform.OS === "ios";

// 로그인 — 회의 2026-10-08. 전화번호 로그인은 없다.
// 간편 로그인: 안드로이드는 카카오, iOS는 카카오 + Apple(App Store 가이드라인 4.8: 다른 회사 로그인을 두면 Apple도 둔다).
// 이메일·비밀번호(2026-10-15): 「이메일로 계속하기」 → EmailLogin 화면. 스토어 심사자와 간편 로그인을 못 쓰는 사람용.
// 1분 점검은 로그인 없이 되고, 점검을 건너뛸 때·쓰던 계정으로 들어올 때 여기로 온다.
// 점검 결과를 저장하는 로그인은 결과 화면에서 바로 한다(회의 2026-10-09) — "save"로 여기 오는 건
// 결과 화면이 로그인된 줄 알았는데 그새 세션이 없어진 경우뿐이다.
// 버튼 뒤의 일(로그인 → 쓰던 계정이면 이어 가기, 처음이면 동의 화면)은 useSignIn이 맡는다.

const COPY: Record<LoginPurpose, { title: string; sub: string }> = {
  save: {
    // 짧게, 줄은 직접 나눈다 — 한글은 글자 단위로 줄이 바뀌어 길면 「로/그인」처럼 단어가 쪼개진다.
    // 알람 이야기는 아래 설명 줄이 맡는다.
    title: "결과를 저장하려면\n로그인해 주세요",
    sub: "로그인하면 휴대폰을 바꿔도 점검 결과와 알람이 그대로 남아요.",
  },
  skip: {
    title: IOS ? "카카오·Apple·이메일로\n간편하게 시작해요" : "카카오나 이메일로\n간편하게 시작해요",
    sub: "로그인하면 약 알람과 복약 기록을 모아 둘 수 있어요.",
  },
  returning: {
    title: "쓰던 계정으로 로그인해요",
    sub: "전에 쓰던 계정으로 로그인하면 약과 기록을 그대로 불러와요.",
  },
};

export function LoginScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const purpose: LoginPurpose = route.params?.purpose ?? "skip";
  const medicines: string[] | undefined = route.params?.medicines;
  const copy = COPY[purpose];

  const { busy, signIn, isBusy } = useSignIn(purpose, medicines);

  function goBack() {
    if (isBusy()) return;
    if (nav.canGoBack()) nav.goBack();
    else nav.reset({ index: 0, routes: [{ name: "Intro", params: { slide: "cta" } }] });
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={goBack} disabled={busy !== null} hitSlop={12} style={styles.backBtn}
          accessibilityRole="button" accessibilityLabel="뒤로">
          <ChevronLeft size={26} color={colors.textSecondary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.logo}><Logo size={LOGO_SIZE} /></View>
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.sub}>{copy.sub}</Text>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: spacing.lg + insets.bottom }]}>
        <SignInButtons
          kakaoLabel="카카오로 계속하기"
          busy={busy}
          onPress={(kind) => { void signIn(kind); }}
          onEmail={() => { if (!isBusy()) nav.navigate("EmailLogin", { purpose, medicines }); }}
        />

        <Text style={styles.note}>
          {IOS ? "카카오·Apple 계정이나 이메일로 로그인해요." : "카카오 계정이나 이메일로 로그인해요."}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  header: { height: 56, flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.sm },
  backBtn: { width: minTouch, height: minTouch, alignItems: "center", justifyContent: "center" },
  body: { flexGrow: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  logo: {
    width: LOGO_CARD, height: LOGO_CARD, borderRadius: radii.hero, backgroundColor: colors.surfaceRaised,
    alignItems: "center", justifyContent: "center", marginBottom: spacing.xl,
    ...shadows.card,
  },
  title: { fontSize: 28, lineHeight: 39, fontWeight: "800", color: colors.primaryNavy, textAlign: "center", letterSpacing: -0.6 },
  sub: { marginTop: spacing.md, fontSize: fontSizes.body, lineHeight: 27, color: colors.textSecondary, textAlign: "center" },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm },
  note: { marginTop: spacing.xs, fontSize: fontSizes.body, lineHeight: 26, color: colors.textSecondary, textAlign: "center" },
});
