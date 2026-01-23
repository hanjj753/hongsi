// app/(tabs)/message.tsx
import React, { useState } from "react";
import {
  Alert,
  NativeModules,
  PermissionsAndroid,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

// ✅ 너의 Apps Script URL
const GOOGLE_SCRIPT_URL =
  "REMOVED_PRIVATE_SCRIPT_URL";

// ✅ 네이티브 모듈 (없을 수도 있으니 안전하게)
const { DirectSms } = NativeModules as {
  DirectSms?: { sendDirectSms: (phone: string, message: string) => void };
};

export default function MessageScreen() {
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [log, setLog] = useState("대기 중...");

  const showAlert = (title: string, msg: string) => {
    if (Platform.OS === "web") window.alert(`${title}\n\n${msg}`);
    else Alert.alert(title, msg);
  };

  // 1) 구글 시트에 "등록"만 (Web/iOS/Android 모두 가능)
  const handleSaveToSheet = async () => {
    if (!phone.trim() || !message.trim()) {
      showAlert("알림", "번호와 내용을 모두 입력해주세요.");
      return;
    }

    setLoading(true);
    try {
      await fetch(GOOGLE_SCRIPT_URL, {
        method: "POST",
        body: JSON.stringify({ action: "add", phone, message }),
      });

      setLog(`데이터 추가됨: ${phone}`);
      showAlert("Success", "구글 시트에 저장되었습니다.");
      setMessage("");
    } catch (e) {
      console.error(e);
      showAlert("Error", "저장에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  };

  // 2) 시트 확인 후 일괄 발송 (Android only)
  const handleCheckAndSend = async () => {
    if (Platform.OS !== "android") {
      showAlert("안내", "문자 발송은 Android에서만 가능합니다.");
      return;
    }

    setLoading(true);
    setLog("권한 확인 중...");

    try {
      // ✅ 권한 요청
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.SEND_SMS,
        {
          title: "문자 보내기 권한",
          message: "앱에서 문자를 자동으로 보내려면 권한이 필요합니다.",
          buttonNeutral: "나중에",
          buttonNegative: "취소",
          buttonPositive: "허용",
        }
      );

      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        showAlert("권한 거부", "권한이 없어서 문자를 보낼 수 없습니다.");
        return;
      }

      if (!DirectSms?.sendDirectSms) {
        setLog("오류: DirectSms 모듈 없음(네이티브 연결 필요)");
        showAlert("Error", "DirectSms 모듈을 찾을 수 없습니다.");
        return;
      }

      setLog("구글 시트 확인 중...");

      // ✅ 시트 데이터 가져오기
      const response = await fetch(GOOGLE_SCRIPT_URL);
      const data = await response.json();

      if (!Array.isArray(data) || data.length === 0) {
        setLog("보낼 문자가 없습니다.");
        showAlert("알림", "대기 중인 문자가 없습니다.");
        return;
      }

      setLog(`총 ${data.length}건 발견. 발송 시작...`);

      // ✅ 하나씩 발송
      for (const item of data) {
        const p = String(item.phone ?? "").trim();
        const m = String(item.message ?? "").trim();
        const row = item.row;

        if (!p || !m || row == null) {
          setLog("스킵: 데이터 형식 오류(전화/메시지/row 확인)");
          continue;
        }

        try {
          DirectSms.sendDirectSms(p, m);

          // 발송 완료 처리
          await fetch(GOOGLE_SCRIPT_URL, {
            method: "POST",
            body: JSON.stringify({ action: "update", row }),
          });

          setLog(`발송 완료: ${p}`);
        } catch (e) {
          console.error(e);
          setLog(`발송 실패: ${p}`);
        }

        // 스팸/연속 제한 방지
        await new Promise((r) => setTimeout(r, 2000));
      }

      showAlert("완료", "모든 작업이 끝났습니다.");
      setLog("모든 발송 완료.");
    } catch (e) {
      console.error(e);
      setLog("Error 발생.");
      showAlert("Error", "작업 중 문제가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>메시지(문자 발송)</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>1. 문자 등록 (Web/App)</Text>

        <TextInput
          style={styles.input}
          placeholder="받는 사람 번호(010-0000-0000)"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
        />

        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="보낼 내용"
          value={message}
          onChangeText={setMessage}
          multiline
        />

        <TouchableOpacity
          style={styles.button}
          onPress={handleSaveToSheet}
          disabled={loading}
        >
          <Text style={styles.buttonText}>
            {loading ? "처리 중..." : "구글 시트에 저장 (발송 X)"}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.divider} />

      {/* Android에서만 발송 UI 표시 */}
      {Platform.OS === "android" && (
        <View style={[styles.card, styles.senderCard]}>
          <Text style={styles.cardTitle}>2. 문자 발송 (Android Only)</Text>
          <Text style={styles.description}>
            이 버튼을 누르면 구글 시트를 확인하고{"\n"}대기 중인 문자를 일괄
            발송합니다.
          </Text>

          <TouchableOpacity
            style={[styles.button, styles.sendButton]}
            onPress={handleCheckAndSend}
            disabled={loading}
          >
            <Text style={styles.buttonText}>
              {loading ? "처리 중..." : "시트 확인 및 문자 발송"}
            </Text>
          </TouchableOpacity>

          <View style={styles.logBox}>
            <Text style={styles.logText}>{log}</Text>
          </View>
        </View>
      )}

      {Platform.OS !== "android" && (
        <Text style={{ color: "#777", marginTop: 10 }}>
          iOS/Web에서는 “등록”만 가능하고, “발송”은 Android에서만 가능합니다.
        </Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: "#f5f5f5",
    alignItems: "center",
    padding: 20,
    paddingTop: 60,
  },
  title: { fontSize: 22, fontWeight: "bold", marginBottom: 20, color: "#333" },
  card: {
    width: "100%",
    backgroundColor: "#fff",
    borderRadius: 15,
    padding: 20,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  senderCard: { backgroundColor: "#e3f2fd" },
  cardTitle: { fontSize: 17, fontWeight: "bold", marginBottom: 12, color: "#444" },
  description: { fontSize: 14, color: "#666", marginBottom: 12, lineHeight: 20 },
  input: {
    width: "100%",
    height: 50,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    paddingHorizontal: 15,
    marginBottom: 10,
    fontSize: 16,
    backgroundColor: "#fafafa",
  },
  textArea: { height: 100, paddingTop: 12, textAlignVertical: "top" },
  button: {
    backgroundColor: "#2196F3",
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 4,
  },
  sendButton: { backgroundColor: "#ff5722" },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  divider: { height: 1, width: "100%", backgroundColor: "#ccc", marginVertical: 10 },
  logBox: { marginTop: 12, backgroundColor: "#000", padding: 10, borderRadius: 5 },
  logText: {
    color: "#0f0",
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
    fontSize: 12,
  },
});
