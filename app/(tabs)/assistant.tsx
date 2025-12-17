import { View, Text } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

export default function AssistantScreen() {
  return (
  <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
    <Ionicons name="people-outline" size={24} color="black" />
    <Text>조교 기능 화면입니다 </Text>
  </View>
  );
}