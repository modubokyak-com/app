import React from "react";
import { View, Text, StyleSheet, Pressable, Platform, ActivityIndicator } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import { Mail, MessageCircle } from "lucide-react-native";
import type { SignInBusy, SignInKind } from "../navigation/useSignIn";
import { colors, fontSizes, spacing, radii, minTouch } from "../theme/tokens";

const IOS = Platform.OS === "ios";

// 로그인 버튼 묶음 — 로그인 화면과 점검 결과 화면이 같이 쓴다.
// 안드로이드는 카카오, iOS는 카카오 아래에 Apple 공식 버튼을 같은 크기로 둔다
// (App Store 가이드라인 4.8: 다른 회사 로그인을 두면 Apple도 대등하게 둔다).
// 맨 아래 「이메일로 계속하기」(onEmail이 있을 때, 2026-10-15)는 이메일 입력 화면으로 가는 테두리 버튼 —
// 심사자와 카카오·Apple을 못 쓰는 사람을 위한 길이라 공식 버튼보다 조용한 모양이다.
// 누르는 일은 useSignIn이 맡고, 여기는 모양과 로그인 중 표시만 한다.
export function SignInButtons({ kakaoLabel, busy, onPress, onEmail }: {
  kakaoLabel: string;
  busy: SignInBusy | null;
  onPress: (kind: SignInKind) => void;
  onEmail?: () => void;
}) {
  return (
    <View style={styles.wrap}>
      {/* 카카오 공식 버튼 규격: 노랑 바탕, 검정 말풍선 심볼, 검정 85% 글자 */}
      <Pressable
        onPress={() => onPress("kakao")}
        disabled={busy !== null}
        accessibilityRole="button"
        accessibilityLabel={kakaoLabel}
        accessibilityState={{ disabled: busy !== null, busy: busy === "kakao" }}
        style={({ pressed }) => [styles.kakaoBtn, pressed && styles.pressed, busy !== null && busy !== "kakao" && styles.dimmed]}
      >
        {busy === "kakao" ? (
          <ActivityIndicator color={colors.kakaoSymbol} />
        ) : (
          <MessageCircle size={24} color={colors.kakaoSymbol} fill={colors.kakaoSymbol} />
        )}
        <Text style={styles.kakaoText}>{busy === "kakao" ? "로그인 중…" : kakaoLabel}</Text>
      </Pressable>

      {/* Apple 공식 버튼 — 글자·모양은 Apple이 그린다. 로그인 중에는 눌리지 않게 감싼다. */}
      {IOS ? (
        <View pointerEvents={busy !== null ? "none" : "auto"} style={[styles.appleWrap, busy !== null && styles.dimmed]}>
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
            cornerRadius={radii.small}
            style={styles.appleBtn}
            onPress={() => onPress("apple")}
          />
        </View>
      ) : null}

      {onEmail ? (
        <Pressable
          onPress={onEmail}
          disabled={busy !== null}
          accessibilityRole="button"
          accessibilityLabel="이메일로 계속하기"
          accessibilityState={{ disabled: busy !== null }}
          style={({ pressed }) => [styles.emailBtn, pressed && styles.pressed, busy !== null && styles.dimmed]}
        >
          <Mail size={24} color={colors.primaryNavy} />
          <Text style={styles.emailText}>이메일로 계속하기</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  kakaoBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    minHeight: minTouch, borderRadius: radii.small, backgroundColor: colors.kakao, paddingHorizontal: spacing.md,
  },
  kakaoText: { fontSize: fontSizes.emphasis, fontWeight: "700", color: colors.kakaoLabel },
  appleWrap: { width: "100%" },
  appleBtn: { width: "100%", height: minTouch },
  emailBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    minHeight: minTouch, borderRadius: radii.small, backgroundColor: colors.surfaceRaised,
    borderWidth: 1.5, borderColor: colors.border, paddingHorizontal: spacing.md,
  },
  emailText: { fontSize: fontSizes.emphasis, fontWeight: "700", color: colors.primaryNavy },
  pressed: { opacity: 0.85 },
  dimmed: { opacity: 0.5 },
});
