import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo, Animated, BackHandler, Easing, Pressable, ScrollView, StyleSheet, Text, View, Alert } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Check, Leaf, Package, Pill } from "lucide-react-native";
import { Logo } from "../components/Logo";
import { INTRO_SLIDES, SKIP_TARGET_INDEX, dotState, nextIndex, prevIndex } from "../lib/introSlides";
import { setOnboarded } from "../lib/storage";
import { trackApp } from "../lib/appStats";
import { colors, fontSizes, minTouch, radii, shadows, spacing } from "../theme/tokens";

// 인트로 — 브랜드 1장 → 온보딩 2장 → 시작 CTA, 총 4장을 한 화면에서 넘긴다.
// (회의 2026-09-03: 시안 V8의 7장에서 브랜드 로고·1분 복용 점검 소개·약사가 설계한
// 기준 슬라이드를 삭제했다.) 옛 Splash + Onboarding 화면을 대체한다.
// 슬라이드 순서·자동 진행 시간은 lib/introSlides.ts.

const FADE_MS = 220;

// 움직임 줄이기 설정 — 모듈 단위로 한 번 읽어 Reveal이 공유한다(슬라이드마다 다시 묻지 않게).
let reduceMotionGlobal = false;
// 비동기 조회가 끝나기 전에 애니메이션이 시작되지 않도록, 시작 전 반드시 이 프라미스를 기다린다.
const reduceMotionReady: Promise<boolean> = AccessibilityInfo.isReduceMotionEnabled()
  .then((v) => { reduceMotionGlobal = v; return v; })
  .catch(() => false);

type RevealKind = "up" | "pop" | "fade" | "scale" | "line" | "bar";

// 시안 V8의 요소별 등장 애니메이션(@keyframes bUp/bPop/bFade/bScale/bLine/bBar)을 그대로 옮긴 것.
//  up   : 아래 16px에서 올라오며 나타남      pop  : 0.5배에서 1.12배로 튀었다가 제자리
//  fade : 투명→불투명                        scale: 0.92배에서 커지며 나타남
//  line : 세로로 그려짐(scaleY 0→1)         bar  : 진행 막대(width 5%→100%, 네이티브 드라이버 불가)
// 지연·길이는 ms. 슬라이드가 바뀌면 컴포넌트가 새로 마운트되므로 매번 처음부터 재생된다.
function Reveal({ delay = 0, duration = 500, kind = "up", style, children }: {
  delay?: number; duration?: number; kind?: RevealKind; style?: any; children?: React.ReactNode;
}) {
  const t = useRef(new Animated.Value(reduceMotionGlobal ? 1 : 0)).current;
  useEffect(() => {
    let cancelled = false;
    let anim: Animated.CompositeAnimation | null = null;
    void reduceMotionReady.then((rm) => {
      if (cancelled) return;
      if (rm) { t.setValue(1); return; }
      anim = Animated.timing(t, {
        toValue: 1, duration, delay,
        easing: kind === "pop" ? Easing.out(Easing.back(1.6)) : Easing.out(Easing.ease),
        useNativeDriver: kind !== "bar",
      });
      anim.start();
    });
    return () => { cancelled = true; anim?.stop(); };
  }, [t, delay, duration, kind]);

  if (kind === "bar") {
    return <Animated.View style={[style, { width: t.interpolate({ inputRange: [0, 1], outputRange: ["5%", "100%"] }) }]}>{children}</Animated.View>;
  }
  const opacity = kind === "line" ? 1 : t.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 1, 1] });
  const transform =
    kind === "up" ? [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }]
    : kind === "pop" ? [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }]
    : kind === "scale" ? [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }]
    : kind === "line" ? [{ scaleY: t }]
    : [];
  return <Animated.View style={[style, { opacity, transform }]}>{children}</Animated.View>;
}

export function IntroScreen() {
  const nav = useNavigation<any>();
  const insets = useSafeAreaInsets();
  // 점검 1/3에서 「뒤로」로 돌아오면 시작 화면(마지막 장)부터 — 브랜드부터 다시 넘기게 하지 않는다.
  const initialIndex = useRoute<any>().params?.slide === "cta" ? SKIP_TARGET_INDEX : 0;
  const [index, setIndex] = useState(initialIndex);
  const indexRef = useRef(initialIndex);
  const opacity = useRef(new Animated.Value(1)).current;
  const reduceMotion = useRef(false);
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaving = useRef(false);
  const ctaTracked = useRef(false);

  // 시작 장(CTA)이 보이면 센다 — 처음부터 그 장으로 열린 경우(뒤로 돌아옴)도 포함. 장을 오가도 마운트당 한 번만.
  useEffect(() => {
    if (index !== SKIP_TARGET_INDEX || ctaTracked.current) return;
    ctaTracked.current = true;
    trackApp("intro_cta");
  }, [index]);

  // 인사 TTS는 제거했다 (피드백 2026-09-03: 음성과 화면 문구가 달라 혼동을 준다).

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => { if (alive) reduceMotion.current = v; })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const clearAuto = useCallback(() => {
    if (autoTimer.current) { clearTimeout(autoTimer.current); autoTimer.current = null; }
  }, []);

  // 슬라이드 전환 — 페이드 아웃 → 인덱스 교체 → 페이드 인. 움직임 줄이기 설정이면 바로 교체.
  const goTo = useCallback((next: number) => {
    clearAuto();
    if (next === indexRef.current) return;
    const swap = () => { indexRef.current = next; setIndex(next); };
    if (reduceMotion.current) { swap(); return; }
    Animated.timing(opacity, { toValue: 0, duration: FADE_MS, useNativeDriver: true }).start(({ finished }) => {
      if (!finished) return;
      swap();
      Animated.timing(opacity, { toValue: 1, duration: FADE_MS, useNativeDriver: true }).start();
    });
  }, [clearAuto, opacity]);

  // 자동 진행(브랜드 슬라이드). 슬라이드가 바뀔 때마다 다시 건다; 화면을 떠나면 모두 지운다.
  useEffect(() => {
    const ms = INTRO_SLIDES[index].autoAdvanceMs;
    if (ms === null) return;
    autoTimer.current = setTimeout(() => goTo(nextIndex(index)), ms);
    return clearAuto;
  }, [index, goTo, clearAuto]);

  useEffect(() => () => { clearAuto(); opacity.stopAnimation(); }, [clearAuto, opacity]);

  // 하드웨어 뒤로가기 — 이전 슬라이드. 첫 슬라이드에서는 기본 동작.
  // 로그인 화면이 위에 쌓여 있을 때는 손대지 않는다(그 화면이 닫혀야 한다).
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!nav.isFocused()) return false;
      const prev = prevIndex(indexRef.current);
      if (prev === null) return false;
      goTo(prev);
      return true;
    });
    return () => sub.remove();
  }, [goTo, nav]);

  const tapNext = () => goTo(nextIndex(indexRef.current));
  const skip = () => goTo(SKIP_TARGET_INDEX);

  // 두 번 눌러 reset이 두 번 나가지 않게 (입력을 잠그는 게 아니라 재진입만 막는다).
  async function leave(routes: { name: string; params?: object }[]) {
    if (leaving.current) return;
    leaving.current = true;
    clearAuto();
    try {
      await setOnboarded();
    } catch {
      // 온보딩 완료 표시는 다음 실행에 인트로를 다시 보일지만 정한다 — 진행은 막지 않되 알린다.
      Alert.alert("설정을 저장하지 못했어요", "다음에 앱을 열면 소개 화면이 한 번 더 보일 수 있어요.");
    }
    try {
      nav.reset({ index: routes.length - 1, routes });
    } finally {
      leaving.current = false;
    }
  }
  // 회의 2026-10-08: 점검은 로그인 없이 하고, 결과를 저장할 때 로그인한다.
  // 건너뛰면 로그인(카카오·Apple) → 처음이면 동의 → 알람 설정 물음. 쓰던 계정이면 로그인 → 홈.
  // from: "intro" — 점검 1/3의 「뒤로」가 인트로로 돌아오게 한다(회의 2026-09-20).
  const startQuickCheck = () => void leave([{ name: "QuickCheckInput", params: { from: "intro" } }]);
  // 로그인은 쌓아서 연다 — 로그인 화면의 「뒤로」가 이 시작 장으로 돌아온다.
  async function toLogin(purpose: "skip" | "returning") {
    if (leaving.current) return;
    leaving.current = true;
    clearAuto();
    try {
      await setOnboarded();
    } catch {
      // 온보딩 완료 표시는 다음 실행에 인트로를 다시 보일지만 정한다 — 진행은 막지 않는다.
    }
    try {
      nav.navigate("Login", { purpose });
    } finally {
      leaving.current = false;
    }
  }

  const slide = INTRO_SLIDES[index];
  const dots = dotState(index);

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {/* 상단 바 — 온보딩 슬라이드(2~3)에서만: 점 2개 + 건너뛰기 */}
      {slide.showBar ? (
        <View style={styles.bar}>
          <View style={styles.barSpacer} />
          <View style={styles.dots} accessibilityLabel={`${dots.active + 1}쪽, 전체 ${dots.count}쪽`}>
            {Array.from({ length: dots.count }).map((_, i) => (
              <View key={i} style={[styles.dot, i === dots.active && styles.dotOn]} />
            ))}
          </View>
          <Pressable onPress={skip} hitSlop={8} style={styles.skipBtn} accessibilityRole="button" accessibilityLabel="건너뛰기">
            <Text style={styles.skipText}>건너뛰기</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.bar} />
      )}

      <Animated.View style={[styles.body, { opacity }]}>
        {index === 0 ? <Brand1 onTap={tapNext} /> : null}
        {index === 1 ? <Onboarding1 onNext={tapNext} /> : null}
        {index === 2 ? <Onboarding2 onNext={tapNext} /> : null}
        {index === 3 ? <Cta onPrimary={startQuickCheck} onSecondary={() => void toLogin("skip")} onLogin={() => void toLogin("returning")} /> : null}
      </Animated.View>
    </View>
  );
}

// ── 1. 브랜드 인트로 ────────────────────────────────────────────────────────
// 형광펜 밑줄 — 글자 뒤 전체를 칠하지 않고 아래쪽에만 밴드를 깐다 (피드백 2026-09-03).
// RN의 중첩 Text 배경은 줄 전체 높이를 칠하므로, 구절을 View로 감싸고 밴드를 절대배치한다.
// delay(ms) 뒤에 형광펜을 왼쪽에서 오른쪽으로 쭉 긋는다 (시안 V8의 bWipe 0.65s).
// 움직임 줄이기 설정이면 즉시 다 그어진 상태로 보여 준다.
function HL({ band, delay = 0, children }: { band: string; delay?: number; children: React.ReactNode }) {
  const [w, setW] = useState(0);
  const t = useRef(new Animated.Value(reduceMotionGlobal ? 1 : 0)).current;
  const started = useRef(false);
  useEffect(() => {
    if (w === 0 || started.current) return;
    let cancelled = false;
    let anim: Animated.CompositeAnimation | null = null;
    void reduceMotionReady.then((rm) => {
      if (cancelled || started.current) return;
      started.current = true;
      if (rm) { t.setValue(1); return; }
      anim = Animated.timing(t, {
        toValue: 1, duration: 650, delay,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false, // width 애니메이션이라 JS 드라이버
      });
      anim.start();
    });
    return () => { cancelled = true; anim?.stop(); };
  }, [t, w, delay]);
  return (
    <View style={styles.hlWrap} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      <Animated.View
        style={[styles.hlBand, {
          backgroundColor: band,
          right: undefined,
          width: t.interpolate({ inputRange: [0, 1], outputRange: [0, w + 6] }),
        }]}
      />
      {children}
    </View>
  );
}

function Brand1({ onTap }: { onTap: () => void }) {
  return (
    <Pressable onPress={onTap} style={styles.brand1} accessibilityRole="button" accessibilityLabel="탭하여 계속">
      <Reveal delay={150} duration={600}><Text style={styles.brand1Big}>진짜 건강은</Text></Reveal>
      <Reveal delay={1000} duration={600}><Text style={styles.brand1Sub}>더 많이 먹는 것이 아니라,</Text></Reveal>
      <Reveal delay={1800} duration={650}>
        <View style={[styles.hlRow, styles.brand1LineTop]}>
          <HL band={colors.successMark} delay={2100}><Text style={styles.brand1Line}>제대로 먹는 것</Text></HL>
          <Text style={styles.brand1Line}>에서</Text>
        </View>
        <Text style={styles.brand1Line}>시작됩니다.</Text>
      </Reveal>
      <Reveal delay={2600} kind="fade" style={styles.tapHintWrap}><Text style={styles.tapHint}>탭하여 계속</Text></Reveal>
    </Pressable>
  );
}

// ── 2. 하나의 복용 조합 ─────────────────────────────────────────────────────
const TILES = [
  { Icon: Pill, label: "처방약", bg: colors.primarySoft, color: colors.primaryBlue },
  { Icon: Package, label: "일반의약품", bg: colors.lightBlueBg, color: colors.secondaryBlue },
  { Icon: Leaf, label: "건강기능식품", bg: colors.successSoft, color: colors.successGreen },
];

function Onboarding1({ onNext }: { onNext: () => void }) {
  return (
    <View style={styles.onb}>
      <ScrollView contentContainerStyle={styles.onbCenter} showsVerticalScrollIndicator={false}>
        <Reveal delay={50}>
          <Text style={styles.onb1Title}>
            <Text style={styles.accentBlue}>영양제부터 처방약까지,</Text>
          </Text>
          {/* 제목이 가운데 정렬이라 줄바꿈돼도 가운데를 유지하도록 hlRowCenter */}
          <View style={styles.hlRowCenter}>
            <Text style={[styles.onb1Title, styles.noTop]}>몸에서는 </Text>
            <HL band={colors.successMark} delay={450}><Text style={[styles.onb1Title, styles.noTop]}>하나의 복용 조합</Text></HL>
            <Text style={[styles.onb1Title, styles.noTop]}>입니다.</Text>
          </View>
        </Reveal>
        <View style={styles.tiles}>
          {TILES.map(({ Icon, label, bg, color }, i) => (
            <Reveal key={label} delay={300 + i * 200} duration={400} style={styles.tile}>
              <View style={[styles.tileIcon, { backgroundColor: bg }]}><Icon size={30} strokeWidth={2.2} color={color} /></View>
              <Text style={styles.tileLabel}>{label}</Text>
            </Reveal>
          ))}
        </View>
        {/* 회의 2026-09-06: 칩 「내 몸속 하나의 복용 조합」·본문 3줄은 헤드라인의 반복이라 지웠다.
            헤드라인 + 아이콘 3개로 전달이 끝난다(칩을 잇던 연결선도 함께). */}
      </ScrollView>
      <NextButton onPress={onNext} />
    </View>
  );
}

// ── 3. 낭비와 위험 ──────────────────────────────────────────────────────────
// 피드백 2026-09-03: "잘못된 조합·낭비·건강을 해칠 수 있다"를 더 강조 —
// "잘못된 복용 조합은"에도 위험색(dangerSoft) 형광 밴드를 긋는다.
function Onboarding2({ onNext }: { onNext: () => void }) {
  return (
    <View style={styles.onb}>
      <ScrollView contentContainerStyle={styles.onbCenterLeft} showsVerticalScrollIndicator={false}>
        <Reveal delay={150} duration={550}><Text style={styles.onb2Lead}>건강을 위해 챙겨 먹는 약과 영양제.</Text></Reveal>
        <Reveal delay={550} duration={600}>
        <View style={[styles.hlRow, styles.onb2TitleTop]}>
          <HL band={colors.warningMark} delay={900}><Text style={[styles.onb2Title, styles.noTop]}>불필요한 영양제</Text></HL>
          <Text style={[styles.onb2Title, styles.noTop]}>는</Text>
        </View>
        <Text style={[styles.onb2Title, styles.noTop]}>
          <Text style={styles.accentOrange}>낭비</Text>가 되고,
        </Text>
        <View style={styles.hlRow}>
          <HL band={colors.dangerMark} delay={1400}><Text style={[styles.onb2Title, styles.noTop]}>잘못된 복용 조합은</Text></HL>
        </View>
        <Text style={[styles.onb2Title, styles.noTop]}>
          <Text style={styles.accentRed}>건강을 해칠 수 있습니다.</Text>
        </Text>
        </Reveal>
      </ScrollView>
      <NextButton onPress={onNext} />
    </View>
  );
}

// ── 4. 시작 CTA ─────────────────────────────────────────────────────────────
// 첫 줄: 점검은 로그인 없이 된다(회의 2026-10-08). 옛 문구 「이름만 적고 바로」는 3/3 이름 칸이 없어져 바꿨다.
const CHECKS = ["로그인 없이 바로", "영양제·약 한 번에 분석", "사진·이름 일부로도 가능"];

function Cta({ onPrimary, onSecondary, onLogin }: { onPrimary: () => void; onSecondary: () => void; onLogin: () => void }) {
  return (
    <View style={styles.onb}>
      <ScrollView contentContainerStyle={styles.ctaCenter} showsVerticalScrollIndicator={false}>
        <Reveal delay={150} duration={550} kind="scale"><View style={styles.logoRingSmall}><Logo size={84} /></View></Reveal>
        <Reveal delay={750} duration={600}>
          <View style={[styles.hlRowCenter, styles.ctaLeadTop]}>
            <HL band={colors.warningMark} delay={1050}><Text style={styles.ctaLead}>불필요한 소비를 줄이고,</Text></HL>
          </View>
          <View style={[styles.hlRowCenter, styles.ctaTitleTop]}>
            <HL band={colors.successMark} delay={1250}><Text style={[styles.ctaTitle, styles.noTop]}>건강해지는 복용</Text></HL>
            <Text style={[styles.ctaTitle, styles.noTop]}>의</Text>
          </View>
          <Text style={[styles.ctaTitle, styles.noTop]}>첫걸음, 지금 시작해보세요.</Text>
        </Reveal>
        <Reveal delay={1000} duration={550}><Text style={styles.ctaSub}>1분이면 충분합니다.</Text></Reveal>
        <View style={styles.checkList}>
          {CHECKS.map((t, i) => (
            <Reveal key={t} delay={1300 + i * 200} duration={500} style={styles.checkRow}>
              <View style={styles.checkDot}><Check size={13} strokeWidth={3} color={colors.white} /></View>
              <Text style={styles.checkText}>{t}</Text>
            </Reveal>
          ))}
        </View>
      </ScrollView>
      {/* 회의 2026-09-03: 점검+알람은 한 흐름. 회의 2026-10-08: 건너뛰면 로그인부터 */}
      <Reveal delay={1600} duration={550}>
        <Pressable onPress={onPrimary} accessibilityRole="button" accessibilityLabel="1분 점검하고 시작하기"
          style={({ pressed }) => [styles.ctaPrimary, pressed && styles.pressed]}>
          <Text style={styles.ctaPrimaryText}>1분 점검하고 시작하기</Text>
        </Pressable>
      </Reveal>
      <Reveal delay={1750} duration={550}>
        <Pressable onPress={onSecondary} accessibilityRole="button" accessibilityLabel="지금은 건너뛰기"
          style={({ pressed }) => [styles.ctaSecondary, pressed && { opacity: 0.7 }]}>
          <Text style={styles.ctaSecondaryText}>지금은 건너뛰기</Text>
        </Pressable>
      </Reveal>
      {/* 이미 쓰던 계정 — 로그인하면 약과 기록을 그대로 불러온다. 처음 쓰는 사람에게는 보조 링크다. */}
      <Reveal delay={1900} duration={550}>
        <Pressable onPress={onLogin} accessibilityRole="button" accessibilityLabel="이미 계정이 있어요. 로그인"
          style={({ pressed }) => [styles.ctaRestore, pressed && { opacity: 0.6 }]}>
          <Text style={styles.ctaRestoreText}>이미 계정이 있어요 · 로그인</Text>
        </Pressable>
      </Reveal>
    </View>
  );
}

function NextButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="다음"
      style={({ pressed }) => [styles.nextBtn, pressed && styles.pressed]}>
      <Text style={styles.nextText}>다음</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  body: { flex: 1 },

  // 상단 바 (시안 52px)
  bar: { height: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 10 },
  barSpacer: { width: 84 },
  dots: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.border },
  dotOn: { width: 22, backgroundColor: colors.primaryBlue },
  skipBtn: { minWidth: 84, minHeight: minTouch, alignItems: "flex-end", justifyContent: "center", paddingHorizontal: 12 },
  skipText: { fontSize: fontSizes.body, fontWeight: "600", color: colors.textSecondary },

  // 공통 서식
  accentBlue: { color: colors.primaryBlue },
  accentOrange: { color: colors.warningOrange },
  accentRed: { color: colors.dangerRed },
  // 형광펜 밑줄 밴드 — 줄 높이의 아래 1/3만 칠한다
  hlWrap: { position: "relative", alignSelf: "flex-start" },
  hlBand: { position: "absolute", left: -3, right: -3, bottom: "12%", height: "34%", borderRadius: 4 },
  hlRow: { flexDirection: "row", alignItems: "flex-end", flexWrap: "wrap" },
  hlRowCenter: { flexDirection: "row", alignItems: "flex-end", flexWrap: "wrap", justifyContent: "center" },
  noTop: { marginTop: 0 },
  tapHintWrap: { position: "absolute", bottom: spacing.lg, alignSelf: "center" },
  tapHint: { fontSize: fontSizes.body, fontWeight: "600", color: colors.textSecondary },
  pressed: { opacity: 0.9, transform: [{ scale: 0.98 }] },

  // 1
  brand1: { flex: 1, justifyContent: "center", paddingHorizontal: spacing.xl, paddingBottom: 48 },
  brand1Big: { fontSize: fontSizes.hero, fontWeight: "800", color: colors.primaryNavy, letterSpacing: -1 },
  brand1Sub: { marginTop: spacing.md, fontSize: fontSizes.title, fontWeight: "500", color: colors.textSecondary, letterSpacing: -0.5 },
  brand1LineTop: { marginTop: 14 },
  brand1Line: { fontSize: 34, lineHeight: 48, fontWeight: "800", color: colors.primaryNavy, letterSpacing: -1 },

  // 온보딩 공통 (시안 padding 6px 24px 24px)
  onb: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: 6, paddingBottom: spacing.lg },
  onbCenter: { flexGrow: 1, justifyContent: "center", paddingBottom: spacing.md },
  onbCenterLeft: { flexGrow: 1, justifyContent: "center", paddingBottom: spacing.md },
  nextBtn: { height: minTouch, borderRadius: radii.pill, backgroundColor: colors.primaryBlue, alignItems: "center", justifyContent: "center" },
  nextText: { color: colors.white, fontSize: 19, fontWeight: "800", letterSpacing: -0.3 },

  // 2 — 하나의 복용 조합
  onb1Title: { textAlign: "center", fontSize: 26, lineHeight: 38, fontWeight: "800", color: colors.primaryNavy, letterSpacing: -0.7 },
  tiles: { flexDirection: "row", marginTop: 30 },
  tile: { flex: 1, alignItems: "center", gap: 6 },
  tileIcon: { width: 56, height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  tileLabel: { fontSize: 18, fontWeight: "700", color: colors.textSecondary },

  // 3 — 낭비와 위험
  onb2Lead: { fontSize: fontSizes.emphasis, fontWeight: "600", color: colors.textSecondary, letterSpacing: -0.5 },
  onb2TitleTop: { marginTop: spacing.md },
  onb2Title: { fontSize: 28, lineHeight: 42, fontWeight: "800", color: colors.primaryNavy, letterSpacing: -0.8 },

  // 4 — 시작 CTA
  checkDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.successGreen, alignItems: "center", justifyContent: "center" },
  ctaCenter: { flexGrow: 1, alignItems: "center", justifyContent: "center", paddingBottom: spacing.md },
  logoRingSmall: { width: 96, height: 96, borderRadius: 48, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  ctaLeadTop: { marginTop: spacing.lg },
  ctaTitleTop: { marginTop: 10 },
  ctaLead: { textAlign: "center", fontSize: 20, fontWeight: "700", color: colors.text, letterSpacing: -0.4 },
  ctaTitle: { marginTop: 10, textAlign: "center", fontSize: 30, lineHeight: 43, fontWeight: "800", color: colors.primaryNavy, letterSpacing: -0.9 },
  ctaSub: { marginTop: 12, textAlign: "center", fontSize: fontSizes.body, fontWeight: "600", color: colors.textSecondary, letterSpacing: -0.3 },
  checkList: { marginTop: 20, gap: 9, alignSelf: "stretch" },
  checkRow: { minHeight: minTouch, paddingHorizontal: 20, borderRadius: 24, backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.successSoft, flexDirection: "row", alignItems: "center", gap: 9 },
  checkText: { fontSize: fontSizes.body, fontWeight: "700", color: colors.primaryNavy, letterSpacing: -0.3 },
  ctaPrimary: { height: 62, borderRadius: 31, backgroundColor: colors.primaryBlue, alignItems: "center", justifyContent: "center", ...shadows.floating },
  ctaPrimaryText: { color: colors.white, fontSize: 21, fontWeight: "800", letterSpacing: -0.3 },
  ctaSecondary: { minHeight: minTouch, marginTop: spacing.sm, alignItems: "center", justifyContent: "center", borderRadius: radii.pill, backgroundColor: colors.primarySoft },
  ctaSecondaryText: { color: colors.primaryNavy, fontSize: fontSizes.emphasis, fontWeight: "700" },
  ctaRestore: { minHeight: minTouch, marginTop: spacing.xs, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.md },
  ctaRestoreText: { color: colors.textSecondary, fontSize: fontSizes.body, fontWeight: "600", textAlign: "center" },
});
