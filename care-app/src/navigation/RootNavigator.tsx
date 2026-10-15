import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import notifee from "@notifee/react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { RootStackParamList, TabParamList } from "./types";
import { getOnboarded } from "../lib/storage";
import { resolveSignedIn } from "./startup";
import { AlarmRouteParams, alarmRouteFromData } from "../lib/alarmPayload";
import { IntroScreen } from "../screens/IntroScreen";
import { LoginScreen } from "../screens/LoginScreen";
import { EmailLoginScreen } from "../screens/EmailLoginScreen";
import { ConsentScreen } from "../screens/ConsentScreen";
import { AccountScreen } from "../screens/AccountScreen";
import { QuickCheckHistoryScreen } from "../screens/QuickCheckHistoryScreen";
import { AlarmPromptScreen } from "../screens/AlarmPromptScreen";
import { HomeScreen } from "../screens/HomeScreen";
import { RecordScreen } from "../screens/RecordScreen";
import { RegisterMethodScreen } from "../screens/RegisterMethodScreen";
import { VoiceGuideScreen } from "../screens/VoiceGuideScreen";
import { ButtonRegisterScreen } from "../screens/ButtonRegisterScreen";
import { OcrRegisterScreen } from "../screens/OcrRegisterScreen";
import { MedicineSearchScreen } from "../screens/MedicineSearchScreen";
import { DoseTimeScreen } from "../screens/DoseTimeScreen";
import { AlarmScreen } from "../screens/AlarmScreen";
import { SnoozePickerScreen } from "../screens/SnoozePickerScreen";
import { SnoozeCountdownScreen } from "../screens/SnoozeCountdownScreen";
import { CheckupScreen } from "../screens/CheckupScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { AlarmSoundScreen } from "../screens/AlarmSoundScreen";
import { PrivacyScreen } from "../screens/PrivacyScreen";
import { CabinetScreen } from "../screens/CabinetScreen";
import { MedicineDetailScreen } from "../screens/MedicineDetailScreen";
import { InteractionScreen } from "../screens/InteractionScreen";
import { QuickCheckInputScreen } from "../screens/QuickCheckInputScreen";
import { QuickCheckAnalyzingScreen } from "../screens/QuickCheckAnalyzingScreen";
import { QuickCheckResultScreen } from "../screens/QuickCheckResultScreen";
import { CareCabinetIcon, CareHomeIcon, CareMoreIcon, CareRecordIcon } from "../components/CareIcons";
import { colors, shadows } from "../theme/tokens";

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

function TabIconBackground({ focused, children }: { focused: boolean; children: React.ReactNode }) {
  return <View style={[styles.tabIconBackground, focused && styles.tabIconBackgroundActive]}>{children}</View>;
}

function PatientTabs() {
  const insets = useSafeAreaInsets();
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primaryBlue,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarHideOnKeyboard: true,
        tabBarStyle: [styles.tabBar, { height: 76 + insets.bottom, paddingBottom: 10 + insets.bottom }],
        tabBarItemStyle: styles.tabItem,
        tabBarIconStyle: styles.tabIcon,
        tabBarLabelStyle: styles.tabLabel,
      }}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ title: "홈", tabBarIcon: ({ color, focused }) => <TabIconBackground focused={focused}><CareHomeIcon size={27} color={color} accent={focused ? colors.coral : color} /></TabIconBackground> }} />
      <Tab.Screen name="Cabinet" component={CabinetScreen} options={{ title: "내 약장", tabBarIcon: ({ color, focused }) => <TabIconBackground focused={focused}><CareCabinetIcon size={27} color={color} accent={focused ? colors.coral : color} /></TabIconBackground> }} />
      <Tab.Screen name="Record" component={RecordScreen} options={{ title: "복약 기록", tabBarIcon: ({ color, focused }) => <TabIconBackground focused={focused}><CareRecordIcon size={27} color={color} accent={focused ? colors.coral : color} /></TabIconBackground> }} />
      <Tab.Screen name="More" component={SettingsScreen} options={{ title: "더보기", tabBarIcon: ({ color, focused }) => <TabIconBackground focused={focused}><CareMoreIcon size={27} color={color} accent={focused ? colors.coral : color} /></TabIconBackground> }} />
    </Tab.Navigator>
  );
}

export function RootNavigator() {
  const [init, setInit] = useState<{ signedIn: boolean; onboarded: boolean } | "loading">("loading");
  const [alarm, setAlarm] = useState<AlarmRouteParams | null>(null);

  useEffect(() => {
    void (async () => {
      // 옛 빌드 정리(clearLocalSession)가 onboarded 표시를 다시 세우므로 정리 전에 읽는다.
      const onboarded = await getOnboarded();
      const signedIn = await resolveSignedIn().catch(() => false);
      try {
        const initial = await notifee.getInitialNotification();
        const alarmRoute = alarmRouteFromData(initial?.notification?.data);
        // 로그아웃 상태면 알람 화면을 열지 않는다 — 기록할 환자가 없다.
        if (alarmRoute && signedIn) setAlarm(alarmRoute);
      } catch {
        // 알림으로 시작하지 않은 일반 진입은 그대로 진행한다.
      }
      setInit({ signedIn, onboarded });
    })();
  }, []);

  if (init === "loading") {
    return <View style={styles.loading}><ActivityIndicator size="large" color={colors.primaryBlue} /></View>;
  }

  // 로그인 전이면 인트로 — 소개를 이미 본 사람은 시작 장(1분 점검 · 건너뛰기 · 로그인)부터.
  const initialRouteName: keyof RootStackParamList = alarm ? "Alarm" : init.signedIn ? "Tabs" : "Intro";
  const introParams = !init.signedIn && init.onboarded ? { slide: "cta" as const } : undefined;

  return (
    <Stack.Navigator
      initialRouteName={initialRouteName}
      screenOptions={{ headerShown: false, contentStyle: styles.stack, animation: "slide_from_right" }}
    >
      <Stack.Screen name="Intro" component={IntroScreen} initialParams={introParams} />
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="EmailLogin" component={EmailLoginScreen} />
      <Stack.Screen name="Consent" component={ConsentScreen} />
      <Stack.Screen name="AlarmPrompt" component={AlarmPromptScreen} />
      <Stack.Screen name="Tabs" component={PatientTabs} />
      <Stack.Screen name="VoiceGuide" component={VoiceGuideScreen} />
      <Stack.Screen name="RegisterMethod" component={RegisterMethodScreen} />
      <Stack.Screen name="ButtonRegister" component={ButtonRegisterScreen} />
      <Stack.Screen name="OcrRegister" component={OcrRegisterScreen} />
      <Stack.Screen name="MedicineSearch" component={MedicineSearchScreen} />
      <Stack.Screen name="DoseTime" component={DoseTimeScreen} />
      <Stack.Screen name="Alarm" component={AlarmScreen} initialParams={alarm ?? undefined} options={{ animation: "fade" }} />
      <Stack.Screen name="SnoozePicker" component={SnoozePickerScreen} options={{ presentation: "transparentModal", animation: "slide_from_bottom" }} />
      <Stack.Screen name="SnoozeCountdown" component={SnoozeCountdownScreen} />
      <Stack.Screen name="Checkup" component={CheckupScreen} />
      <Stack.Screen name="AlarmSound" component={AlarmSoundScreen} />
      <Stack.Screen name="Privacy" component={PrivacyScreen} />
      <Stack.Screen name="Account" component={AccountScreen} />
      <Stack.Screen name="QuickCheckHistory" component={QuickCheckHistoryScreen} />
      <Stack.Screen name="MedicineDetail" component={MedicineDetailScreen} />
      <Stack.Screen name="Interaction" component={InteractionScreen} />
      <Stack.Screen name="QuickCheckInput" component={QuickCheckInputScreen} />
      <Stack.Screen name="QuickCheckAnalyzing" component={QuickCheckAnalyzingScreen} options={{ animation: "fade" }} />
      <Stack.Screen name="QuickCheckResult" component={QuickCheckResultScreen} />
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.canvas },
  stack: { backgroundColor: colors.canvas },
  tabBar: {
    position: "absolute",
    backgroundColor: colors.surfaceRaised,
    borderTopWidth: 0,
    paddingTop: 9,
    ...shadows.floating,
  },
  tabItem: { marginHorizontal: 4, marginVertical: 3 },
  tabIcon: { marginBottom: 1 },
  tabIconBackground: {
    width: 52,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  tabIconBackgroundActive: { backgroundColor: colors.primarySoft },
  // 탭 이름도 본문처럼 읽혀야 한다(고령층). 높이는 위 tabBarStyle(76)·tokens.tabBarClearance와 함께 맞췄다.
  tabLabel: { fontSize: 16, fontWeight: "800", letterSpacing: -0.2 },
});
