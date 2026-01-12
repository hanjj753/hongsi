// 전체 틀을 설정해주는 TypeScript 파일이라 건드릴 필요 X
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { useFonts } from 'expo-font'; // 폰트 로딩 훅
import { SplashScreen } from 'expo-router';

// 사용하는 아이콘 폰트 파일 데이터 가져오기
import Ionicons from '@expo/vector-icons/Ionicons';
import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import AntDesign from '@expo/vector-icons/AntDesign';
import Feather from '@expo/vector-icons/Feather';

// 폰트 로딩 전까지 스플래시 화면 유지 (선택 사항이지만 권장)
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  // 1. 사용할 폰트들을 미리 로드합니다.
  const [loaded, error] = useFonts({
    ...Ionicons.font,
    ...FontAwesome5.font,
    ...AntDesign.font,
    ...Feather.font,
  });

  // 에러 발생 시 출력
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  // 2. 폰트 로딩이 완료되면 스플래시 화면을 숨깁니다.
  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  // 3. 폰트가 로드되지 않았다면 아무것도 렌더링하지 않음 (혹은 로딩바)
  if (!loaded) {
    return null;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}