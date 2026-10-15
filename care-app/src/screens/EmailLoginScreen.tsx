import React, { useRef, useState } from "react";
import { View, Text, TextInput, StyleSheet, Pressable, ScrollView, KeyboardAvoidingView } from "react-native";
import { useRoute } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScreenHeader } from "../components/ScreenHeader";
import { BigButton } from "../components/BigButton";
import { useSignIn, EmailMode } from "../navigation/useSignIn";
import type { LoginPurpose } from "../navigation/types";
import { colors, fontSizes, spacing, radii, minTouch, shadows } from "../theme/tokens";

// 이메일·비밀번호 로그인/가입 (2026-10-15) — 스토어 심사자가 들어올 길과 카카오·Apple을 못 쓰는 사람용.
// 로그인 화면·점검 결과 화면의 「이메일로 계속하기」로 온다. 한 화면에서 로그인 ↔ 가입을 바꾸고(적은 이메일은 남긴다),
// 가입은 확인 메일 없이 바로 로그인된다(autoconfirm). 비밀번호 재설정 메일은 SMTP가 없어 아직 없다 — 안내 글만 둔다.
// 입력 검사·Supabase 오류 안내는 lib/auth.ts(signInWithEmail·signUpWithEmail)가, 로그인 뒤 갈 곳은 useSignIn이 맡는다.

const COPY: Record<EmailMode, { title: string; button: string; busyButton: string; switchLabel: string; note: string }> = {
  login: {
    title: "이메일로 로그인",
    button: "로그인",
    busyButton: "로그인 중…",
    switchLabel: "처음이세요? 이메일로 가입하기",
    note: "비밀번호를 잊으셨으면 앱 스토어 페이지의 지원 이메일로 알려 주세요.",
  },
  signup: {
    title: "이메일로 가입",
    button: "가입하기",
    busyButton: "가입하는 중…",
    switchLabel: "이미 가입했어요. 로그인하기",
    note: "비밀번호는 6자 이상으로 정해 주세요. 가입하면 바로 로그인돼요.",
  },
};

export function EmailLoginScreen() {
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const purpose: LoginPurpose = route.params?.purpose ?? "skip";
  const medicines: string[] | undefined = route.params?.medicines;
  const [mode, setMode] = useState<EmailMode>(route.params?.mode === "signup" ? "signup" : "login");
  const copy = COPY[mode];

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  const { busy, signInEmail, isBusy } = useSignIn(purpose, medicines);
  const working = busy !== null;

  function submit(): void {
    if (isBusy()) return;
    void signInEmail(mode, email, password);
  }

  // 로그인 ↔ 가입 — 적어 둔 이메일·비밀번호는 그대로 둔다(다시 치게 하지 않는다).
  function switchMode(): void {
    if (isBusy()) return;
    setMode((m) => (m === "login" ? "signup" : "login"));
  }

  return (
    // Expo 54는 Android도 edge-to-edge라 키보드가 떠도 창이 안 줄어든다 — 두 플랫폼 모두 padding으로 밀어 올린다.
    // 상단 안전 영역은 ScreenHeader가 직접 더한다(여기서 또 더하면 두 번 띄운다).
    <KeyboardAvoidingView style={styles.screen} behavior="padding">
      <ScreenHeader title={copy.title} />

      <ScrollView contentContainerStyle={styles.c} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <View style={styles.card}>
          <Text style={styles.label} nativeID="emailLabel">이메일</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="example@email.com"
            placeholderTextColor={colors.textSecondary}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="emailAddress"
            autoComplete="email"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => passwordRef.current?.focus()}
            editable={!working}
            accessibilityLabel="이메일"
            accessibilityLabelledBy="emailLabel"
          />

          <Text style={[styles.label, styles.labelGap]} nativeID="passwordLabel">비밀번호</Text>
          <View style={styles.passwordRow}>
            <TextInput
              ref={passwordRef}
              style={[styles.input, styles.passwordInput]}
              value={password}
              onChangeText={setPassword}
              placeholder="6자 이상"
              placeholderTextColor={colors.textSecondary}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
              textContentType={mode === "signup" ? "newPassword" : "password"}
              autoComplete={mode === "signup" ? "new-password" : "password"}
              returnKeyType="done"
              onSubmitEditing={submit}
              editable={!working}
              accessibilityLabel="비밀번호"
              accessibilityLabelledBy="passwordLabel"
            />
            <Pressable
              onPress={() => setShowPassword((v) => !v)}
              style={({ pressed }) => [styles.toggleBtn, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"}
              accessibilityState={{ expanded: showPassword }}
            >
              <Text style={styles.toggleText}>{showPassword ? "숨기기" : "보기"}</Text>
            </Pressable>
          </View>
        </View>

        <Text style={styles.note}>{copy.note}</Text>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: spacing.md + insets.bottom }]}>
        <BigButton label={working ? copy.busyButton : copy.button} onPress={submit} disabled={working} showArrow />
        <Pressable
          onPress={switchMode}
          disabled={working}
          style={({ pressed }) => [styles.switchBtn, pressed && styles.pressed, working && styles.dimmed]}
          accessibilityRole="button"
          accessibilityLabel={copy.switchLabel}
          accessibilityState={{ disabled: working }}
        >
          <Text style={styles.switchText}>{copy.switchLabel}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  c: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.md },
  card: {
    backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderWidth: 1,
    borderRadius: radii.card, padding: spacing.md, ...shadows.card,
  },
  label: { fontSize: fontSizes.body, lineHeight: 26, fontWeight: "800", color: colors.primaryNavy, marginBottom: spacing.sm },
  labelGap: { marginTop: spacing.md },
  input: {
    backgroundColor: colors.cardBg, borderColor: colors.border, borderWidth: 1.5,
    borderRadius: radii.button, fontSize: fontSizes.body, padding: 14, minHeight: minTouch, color: colors.text,
  },
  passwordRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  passwordInput: { flex: 1 },
  toggleBtn: {
    minWidth: minTouch + 16, minHeight: minTouch, alignItems: "center", justifyContent: "center",
    borderRadius: radii.button, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.cardBg,
    paddingHorizontal: spacing.sm,
  },
  toggleText: { fontSize: fontSizes.body, fontWeight: "700", color: colors.primaryBlue },
  note: { fontSize: fontSizes.body, lineHeight: 26, color: colors.textSecondary, paddingHorizontal: spacing.xs },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  switchBtn: { minHeight: minTouch, alignItems: "center", justifyContent: "center", marginTop: spacing.xs },
  switchText: { fontSize: fontSizes.body, fontWeight: "700", color: colors.primaryBlue, textDecorationLine: "underline" },
  pressed: { opacity: 0.85 },
  dimmed: { opacity: 0.5 },
});
