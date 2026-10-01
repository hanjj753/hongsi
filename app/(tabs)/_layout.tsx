import { Tabs } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import AntDesign from '@expo/vector-icons/AntDesign';
import { AppAccessGate } from '../../components/AppAccessGate';

export default function TabLayout() {
  return (
    <AppAccessGate>
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
      {/* 3. 달력 탭 */}
      <Tabs.Screen
        name="calendar"
        options={{
          title: '달력',
          tabBarIcon: ({color, size}) => <FontAwesome5 name="calendar-alt" size={size} color={color} />,
        }}
      />
      {/* 4. 조교 탭 */}
      <Tabs.Screen
        name="assistant"
        options={{
          title: '조교',
          tabBarIcon: ({color, size}) => <Ionicons name="people-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="files"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="inquiry" 
        options={{
          title: "문의",
          tabBarIcon: ({ color }) => <FontAwesome5 name="question-circle" size={24} color={color} />,
        }}
      />
      </Tabs>
    </AppAccessGate>
  );
}
