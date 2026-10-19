import React, { useEffect, useRef, useState } from "react";
import {
  View, Text, TextInput, ScrollView, StyleSheet, Pressable, ActivityIndicator,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Search, Pencil, ChevronRight, Pill } from "lucide-react-native";
import { ScreenHeader } from "../components/ScreenHeader";
import { IllustrationBanner } from "../components/IllustrationBanner";
import { searchProducts, ProductHit } from "../lib/drugData";
import { guessMedKind } from "../lib/medKind";
import { colors, fontSizes, spacing, radii, minTouch } from "../theme/tokens";

const SEARCH_ART = require("../../assets/illustrations/medicine-search.png");

// C-07 약 이름으로 찾기 — 공공데이터(drug_product 21,953건)에서 제품을 골라 등록한다.
// 직접 타이핑한 이름보다 정확한 제품명이 남아야 성분 기반 병용금기 검사가 실제로 걸린다.
// 찾는 약이 없을 수 있으므로 "직접 입력하기" 탈출구를 항상 둔다.

export function MedicineSearchScreen() {
  const nav = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ProductHit[] | null>(null); // null = 아직 검색 안 함
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  // 타이핑할 때마다 조회하면 요청이 쏟아진다 — 잠깐 멈췄을 때만 찾는다.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const mine = ++seq.current;
    const text = q.trim();
    if (text.length < 2) { setHits(null); setLoading(false); return; }
    setLoading(true);
    timer.current = setTimeout(async () => {
      const r = await searchProducts(text, 20);
      if (mine !== seq.current) return; // 늦게 도착한 이전 검색 결과는 버린다
      if (!r.ready) { setUnavailable(true); setHits([]); }
      else { setUnavailable(false); setHits(r.data); }
      setLoading(false);
    }, 350);
    return () => { if (timer.current) clearTimeout(timer.current); if (seq.current === mine) seq.current += 1; };
  }, [q]);

  function choose(name: string) {
    // 복용시점 등록(C-09)이 모든 등록 경로가 만나는 공통 관문이다.
    nav.navigate("DoseTime", { medicineName: name });
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader title="약 이름으로 찾기" />
      <View style={styles.searchWrap}>
        <Search size={20} color={colors.textSecondary} />
        <TextInput
          style={styles.searchInput}
          value={q}
          onChangeText={setQ}
          placeholder="예: 오메가"
          placeholderTextColor={colors.textSecondary}
          autoFocus
          returnKeyType="search"
        />
      </View>

      <ScrollView
        contentContainerStyle={[styles.list, { paddingBottom: spacing.xl + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
      >
        <IllustrationBanner source={SEARCH_ART} tone="cream" height={156} imageScale={0.98} />
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primaryBlue} />
            <Text style={styles.centerText}>찾는 중…</Text>
          </View>
        ) : null}

        {!loading && q.trim().length < 2 ? (
          <Text style={styles.guide}>약 이름을 두 글자 이상 입력해 주세요.</Text>
        ) : null}

        {!loading && hits !== null && unavailable ? (
          <Text style={styles.guide}>
            약 목록을 불러오지 못했어요.{"\n"}인터넷 연결을 확인하거나 아래에서 직접 입력해 주세요.
          </Text>
        ) : null}

        {!loading && hits !== null && !unavailable ? (
          <Text style={styles.count}>
            {hits.length > 0 ? `검색 결과 ${hits.length}개 · 눌러서 고르세요` : "찾는 약이 없어요"}
          </Text>
        ) : null}

        {(hits ?? []).map((h) => {
          const kind = guessMedKind(h.product_name);
          return (
            <Pressable
              key={h.product_code}
              onPress={() => choose(h.product_name)}
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.92 }]}
            >
              <View style={styles.iconBox}><Pill size={22} color={colors.primaryBlue} /></View>
              <View style={styles.info}>
                <Text style={styles.name} numberOfLines={2}>{h.product_name}</Text>
                {h.company ? <Text style={styles.company}>{h.company}</Text> : null}
                {kind ? (
                  <View style={styles.kindBadge}>
                    <Text style={styles.kindText}>{kind}</Text>
                  </View>
                ) : null}
              </View>
              <ChevronRight size={22} color={colors.textSecondary} />
            </Pressable>
          );
        })}

        {/* 탈출구 — 마스터DB에 없는 약도 반드시 등록할 수 있어야 한다 */}
        <View style={styles.escape}>
          <Text style={styles.escapeLabel}>찾는 약이 없나요?</Text>
          <Pressable
            onPress={() => nav.navigate("ButtonRegister")}
            style={({ pressed }) => [styles.escapeBtn, pressed && { opacity: 0.9 }]}
          >
            <Pencil size={20} color={colors.primaryBlue} />
            <Text style={styles.escapeText}>직접 입력하기</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    margin: spacing.md, paddingHorizontal: spacing.md,
    minHeight: minTouch, borderRadius: radii.pill,
    backgroundColor: colors.cardBg, borderColor: colors.border, borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 20, color: colors.text },
  list: { paddingHorizontal: spacing.md, gap: spacing.sm },
  center: { alignItems: "center", gap: spacing.sm, marginTop: spacing.lg },
  centerText: { fontSize: fontSizes.body, color: colors.textSecondary },
  guide: { fontSize: 19, color: colors.textSecondary, lineHeight: 28, marginTop: spacing.md },
  count: { fontSize: fontSizes.body, color: colors.textSecondary, marginBottom: spacing.xs },
  card: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.cardBg, borderColor: colors.border, borderWidth: 1,
    borderRadius: radii.card, padding: spacing.md,
  },
  iconBox: {
    width: 48, height: 48, borderRadius: 12, backgroundColor: colors.lightBlueBg,
    alignItems: "center", justifyContent: "center",
  },
  info: { flex: 1 },
  name: { fontSize: 19, fontWeight: "700", color: colors.text },
  company: { fontSize: fontSizes.body, color: colors.textSecondary, marginTop: 2 },
  kindBadge: {
    alignSelf: "flex-start", marginTop: 6, borderRadius: radii.pill,
    paddingHorizontal: 9, paddingVertical: 3, backgroundColor: colors.successGreen + "1A",
  },
  kindText: { fontSize: 14, fontWeight: "700", color: colors.successGreen },
  escape: {
    marginTop: spacing.lg, paddingTop: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.border, gap: spacing.sm,
  },
  escapeLabel: { fontSize: fontSizes.body, color: colors.textSecondary },
  escapeBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    minHeight: minTouch, borderRadius: radii.button,
    backgroundColor: colors.cardBg, borderColor: colors.primaryBlue, borderWidth: 1,
  },
  escapeText: { fontSize: 20, fontWeight: "700", color: colors.primaryBlue },
});
