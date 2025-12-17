import { View, Text } from 'react-native';
import AntDesign from '@expo/vector-icons/AntDesign';

export default function HomeScreen() {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <AntDesign name="home" size={24} color="black" />
        <Text>홈 화면입니다.</Text>
    </View>);
}