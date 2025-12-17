import { View, Text } from 'react-native';
import Feather from '@expo/vector-icons/Feather';

export default function FilesScreen() {
  return (
  <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
    <Feather name="folder" size={24} color="black" />
    <Text>파일 보관함입니다 </Text>
  </View>
  );
}