import "react-native-gesture-handler";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import React, { useEffect } from "react";
import { AppState } from "react-native";
import { NavigationContainer, createNavigationContainerRef, DefaultTheme } from "@react-navigation/native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import notifee, { EventType } from "@notifee/react-native";
import { RootNavigator } from "./src/navigation/RootNavigator";
import { RootStackParamList } from "./src/navigation/types";
import { takePendingAlarm, getPatientId } from "./src/lib/storage";
import { flushIntakeOutbox, recordIntake } from "./src/lib/records";
import { ensureIOSCategory, stopAlarm, scheduleSnooze } from "./src/lib/notifications";
import { doseSlot } from "./src/lib/schedule";
import { rescheduleCachedAlarm, resyncAllAlarms } from "./src/lib/alarmSync";
import { runLocalAlarmAction } from "./src/lib/alarmResponse";
import { AlarmRouteParams, alarmRouteFromData } from "./src/lib/alarmPayload";
import { startAppStats, trackScreen } from "./src/lib/appStats";
import { applyPretendard } from "./src/theme/applyPretendard";
import { colors } from "./src/theme/tokens";

SplashScreen.preventAutoHideAsync().catch(() => {});

export const navRef = createNavigationContainerRef<RootStackParamList>();

const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.primaryBlue,
    background: colors.canvas,
    card: colors.surfaceRaised,
    text: colors.text,
    border: colors.border,
    notification: colors.coral,
  },
};

function navigateToAlarm(alarm: AlarmRouteParams, attempt = 0) {
  if (navRef.isReady()) {
    navRef.navigate("Alarm", alarm);
  } else if (attempt < 50) {
    setTimeout(() => navigateToAlarm(alarm, attempt + 1), 100);
  }
}

export default function App() {
  const [fontsReady] = useFonts({
    "Pretendard-Regular": require("./assets/fonts/Pretendard-Regular.otf"),
    "Pretendard-SemiBold": require("./assets/fonts/Pretendard-SemiBold.otf"),
    "Pretendard-Bold": require("./assets/fonts/Pretendard-Bold.otf"),
    "Pretendard-ExtraBold": require("./assets/fonts/Pretendard-ExtraBold.otf"),
  });

  // 폰트가 준비된 뒤에야 네이티브 스플래시를 내린다. 시스템 폰트로 한 번 그렸다가
  // 바뀌면 글자 폭이 달라져 화면이 눈에 띄게 튄다.
  useEffect(() => {
    if (!fontsReady) return;
    applyPretendard();
    SplashScreen.hideAsync().catch(() => {});
  }, [fontsReady]);

  // 앱 이용 통계 — 설치 번호·실행 번호를 잡고 first_open/app_open을 보낸다(꺼 둔 기기는 아무것도 보내지 않는다).
  useEffect(() => { startAppStats(); }, []);

  useEffect(() => {
    ensureIOSCategory().catch(() => {});
    const consumePending = async () => {
      const alarm = await takePendingAlarm();
      if (alarm) navigateToAlarm(alarm);
    };
    // 콜드스타트(알람 풀스크린/탭으로 앱이 켜진 경우)의 알람 라우팅은 RootNavigator가
    // 초기 화면을 Alarm으로 잡아 처리한다(홈 깜빡임 방지). 여기선 중복 호출하지 않는다.
    consumePending();
    resyncAllAlarms().catch(() => {});
    getPatientId().then(async (pid) => { if (pid) await flushIntakeOutbox(pid); }).catch(() => {});
    const appSub = AppState.addEventListener("change", (s) => {
      if (s === "active") {
        consumePending();
        resyncAllAlarms().catch(() => {});
        getPatientId().then(async (pid) => { if (pid) await flushIntakeOutbox(pid); }).catch(() => {});
      }
    });
    const unsub = notifee.onForegroundEvent(async ({ type, detail }) => {
      const data = detail.notification?.data as any;
      const sid = data?.scheduleId as string | undefined;
      const alarm = alarmRouteFromData(data);
      if (type === EventType.DELIVERED) {
        // 포그라운드에서 DELIVERED → 화면 이동 + 다음 회차 체이닝(백그라운드 DELIVERED와 동일)
        if (sid) {
          if (alarm) navigateToAlarm(alarm);
          await rescheduleCachedAlarm(sid).catch(() => false);
        }
        return;
      }
      if (type === EventType.PRESS) {
        if (alarm) navigateToAlarm(alarm);
        return;
      }
      if (type === EventType.ACTION_PRESS && sid) {
        const pid = await getPatientId();
        if (!pid) { await stopAlarm(sid); return; } // 기록 불가 — 정리만
        const hour = Number(data?.hour ?? 0), minute = Number(data?.minute ?? 0);
        const slot = doseSlot(hour, minute, new Date());
        // 기기 알람 제어를 먼저 끝내고 서버 기록은 별도로 시도한다(index.ts와 동일 순서).
        try {
          if (detail.pressAction?.id === "complete") {
            const result = await runLocalAlarmAction({
              stop: () => stopAlarm(sid),
              persist: () => recordIntake({ patientId: pid, scheduleId: sid, scheduledFor: slot, status: "completed", method: "버튼" }),
            });
            if (!result.persisted) console.warn("alarm action: server write deferred or local persistence failed");
            // 다음 정시 회차 재예약(멱등 — 이미 예약돼 있으면 덮어씀)
            await rescheduleCachedAlarm(sid).catch(() => false);
          } else if (detail.pressAction?.id === "snooze") {
            // 알림 액션 스누즈 = 앱 안 열고 기본 10분 빠른 스누즈. stopAlarm(기존 스누즈 취소) 후 예약해야 살아남음.
            const result = await runLocalAlarmAction({
              stop: () => stopAlarm(sid),
              afterStop: () => scheduleSnooze(sid, String(data?.medName ?? ""), { mode: "duration", minutes: 10 }, hour, minute, String(data?.tod ?? "아침")),
              persist: () => recordIntake({ patientId: pid, scheduleId: sid, scheduledFor: slot, status: "snoozed", method: "버튼" }),
            });
            if (!result.persisted) console.warn("alarm action: snooze server write deferred or local persistence failed");
            // 다음 정시 회차 재예약(멱등)
            await rescheduleCachedAlarm(sid).catch(() => false);
          } else {
            await stopAlarm(sid);
          }
        } catch {}
        return;
      }
    });
    return () => { appSub.remove(); unsub(); };
  }, []);

  // 폰트 로딩이 실패해도 앱이 영영 안 뜨지는 않는다 — useFonts는 실패해도
  // 결국 true를 돌려주고, 그때는 시스템 폰트로 그려진다.
  if (!fontsReady) return null;

  return (
    // react-navigation의 제스처(스택 뒤로 밀기 등)가 동작하려면 제스처 핸들러 루트가
    // 필요하다. (내 약장의 스와이프는 QA 2026-08-20으로 제거됐지만 루트는 그대로 둔다.)
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        {/* 흰 배경에서 시간·배터리 등 상태바 글씨가 보이도록 어두운 색으로 고정 */}
        <StatusBar style="dark" />
        <NavigationContainer
          ref={navRef}
          theme={navigationTheme}
          // 화면 조회 통계 — 처음 뜬 화면(onReady)과 이후 화면 전환(onStateChange)
          onReady={() => trackScreen(navRef.getCurrentRoute())}
          onStateChange={() => trackScreen(navRef.getCurrentRoute())}
        >
          <RootNavigator />
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
