import { View, Text } from 'react-native';
import FontAwesome5 from '@expo/vector-icons/FontAwesome5';

export default function ClassScreen() {
  return (
  <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
    <FontAwesome5 name="chalkboard" size={24} color="black" />
    <Text>수업 목록이 뜰 화면입니다</Text>
  </View>
  );
}