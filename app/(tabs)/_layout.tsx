import { Tabs } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import AntDesign from '@expo/vector-icons/AntDesign';
import Feather from '@expo/vector-icons/Feather';

export default function TabLayout() {
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: '#ef806c' }}>
      {/* 1. 홈 탭 */}
      <Tabs.Screen
        name="index"
        options={{
          title: '홈',
          tabBarIcon: ({color, size}) => <AntDesign name="home" size={size} color={color} />,
        }}
      />
      {/* 2. 수업 탭 */}
      <Tabs.Screen
        name="class"
        options={{
          title: '수업',
          tabBarIcon: ({color, size}) => <FontAwesome5 name="chalkboard" size={size} color={color} />,
        }}
      />
      {/* 3. 조교 탭 */}
      <Tabs.Screen
        name="assistant"
        options={{
          title: '조교',
          tabBarIcon: ({color, size}) => <Ionicons name="people-outline" size={size} color={color} />,
        }}
      />
      {/* 4. 파일 탭 */}
      <Tabs.Screen
        name="files"
        options={{
          title: '파일',
          tabBarIcon: ({color, size}) => <Feather name="folder" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}