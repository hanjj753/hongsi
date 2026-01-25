// [조교] 탭
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

export default function AssistantScreen() {
  return (
    <View style={styles.container}>
      <Ionicons name="construct-outline" size={60} color="#CBD5E1" style={{ marginBottom: 16 }} />
      <Text style={styles.title}>조교 기능 이동 안내</Text>
      <Text style={styles.desc}>
        기존의 조교 출석 기능은{"\n"}
        <Text style={styles.highlight}>'수업' 탭의 각 수업 상세 화면</Text>으로{"\n"}
        통합되었습니다.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    padding: 24,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: "#334155",
    marginBottom: 12,
  },
  desc: {
    fontSize: 16,
    color: "#64748B",
    textAlign: "center",
    lineHeight: 24,
  },
  highlight: {
    fontWeight: "700",
    color: "#4F46E5",
  },
});