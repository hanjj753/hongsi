import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons'; // 아이콘 사용

export default function LoginScreen() {
  const router = useRouter();

  const handleLogin = () => {
    // 나중에 실제 구글 로그인 로직이 들어갈 곳
    console.log("구글 로그인 시도...");
    
    // 로그인 성공 시 탭 화면으로 이동 (replace는 뒤로가기 방지)
    router.replace('/(tabs)');
  };

  return (
    <View style={styles.container}>
      <Ionicons name="logo-google" size={50} color="#DB4437" style={{ marginBottom: 20 }} />
      <Text style={styles.title}>로그인</Text>
      
      <TouchableOpacity style={styles.button} onPress={handleLogin}>
        <Text style={styles.buttonText}>Google 계정으로 로그인</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 40 },
  button: { 
    backgroundColor: '#4285F4', 
    paddingVertical: 12, 
    paddingHorizontal: 24, 
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center'
  },
  buttonText: { color: 'white', fontSize: 16, fontWeight: '600' },
});