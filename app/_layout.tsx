import { useEffect } from "react";
import { Stack } from "expo-router";
import { useFonts } from "expo-font";
import { SplashScreen } from "expo-router";

import Ionicons from "@expo/vector-icons/Ionicons";
import FontAwesome5 from "@expo/vector-icons/FontAwesome5";
import AntDesign from "@expo/vector-icons/AntDesign";
import Feather from "@expo/vector-icons/Feather";

// 앱 리소스가 로드될 때까지 스플래시 화면 유지
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {

  // 폰트 및 아이콘 로드
  const [loaded, error] = useFonts({
    ...Ionicons.font,
    ...FontAwesome5.font,
    ...AntDesign.font,
    ...Feather.font,
  });

  // 폰트 로딩 에러 처리
  useEffect(() => {
    if (error) {
      console.error("폰트 로딩 에러 (무시하고 진행):", error);
      // 에러가 나도 스플래시를 숨겨서 앱이 보이게 함
      SplashScreen.hideAsync(); 
    }
  }, [error]);

  // 로딩 완료 시 스플래시 화면 숨김
  useEffect(() => {
    if (loaded) SplashScreen.hideAsync();
  }, [loaded]);

  // 로딩 중일 때는 아무것도 렌더링하지 않음 (스플래시가 덮고 있음)
  if (!loaded) {
    return null;
  }

  // 4. 네비게이션 스택 정의
  // Stack Navigator: 화면 전환 관리
  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/* - index: 로그인 화면 (초기 화면)
         - (tabs): 메인 탭 화면 (로그인 후 진입)
         - class/[id]: 수업 상세 및 출석 화면 (동적 라우팅)
      */}
      <Stack.Screen name="index" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="class/[id]" />
    </Stack>
  );
}
