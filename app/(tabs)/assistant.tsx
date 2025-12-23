import React, { useState } from "react";
import { View, Text, Button, ActivityIndicator } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Location from "expo-location";

/* ===============================
   1️⃣ 출석 기준 위치 (여기만 수정)
================================ */
const ATTENDANCE_SPOT = {
  name: "학교 지정 위치",
  lat: 37.502976,   // ← 실제 위도
  lon: 127.044813,  // ← 실제 경도
  radiusMeters: 100 // 허용 반경 (m)
};

const REQUIRED_ACCURACY = 100; // GPS 정확도 기준 (m)

/* ===============================
   2️⃣ 화면 컴포넌트
================================ */
export default function AssistantScreen() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("조교 기능 화면입니다");
  const [distance, setDistance] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [latitude, setLatitude] = useState<number | null>(null);

  const checkAttendance = async () => {
    setLoading(true);
    setMessage("위치 확인 중…");
    setDistance(null);

    try {
      // 위치 권한 요청
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setMessage("❌ 위치 권한이 필요합니다.");
        return;
      }

      // 현재 위치 가져오기
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.BestForNavigation
      });

      const { latitude, longitude, accuracy } = location.coords;
      setLongitude(longitude);
      setLatitude(latitude);
      // 거리 계산
      const dist = haversine(
        latitude,
        longitude,
        ATTENDANCE_SPOT.lat,
        ATTENDANCE_SPOT.lon
      );

      setDistance(dist);

      // 출석 판정
      if ((accuracy ?? 999) > REQUIRED_ACCURACY) {
        setMessage(`❌ GPS 정확도가 낮습니다 (±${Math.round(accuracy!)}m)`);
        return;
      }

      if (dist <= ATTENDANCE_SPOT.radiusMeters) {
        setMessage(`✅ 출석 인정 (${Math.round(dist)}m)`);
        // ⚠️ 실제 서비스에서는 서버로 전송
      } else {
        setMessage(`❌ 출석 반려 (${Math.round(dist)}m)`);
      }

    } catch (err) {
      setMessage("❌ 위치 확인 실패");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", gap: 12 }}>
      <Ionicons name="people-outline" size={28} color="black" />

      <Text style={{ fontSize: 16 }}>{message}</Text>

      {loading ? (
        <ActivityIndicator />
      ) : (
        <Button title="출석 체크" onPress={checkAttendance} />
      )}

      {distance !== null && (
        <Text style={{ fontSize: 12, opacity: 0.7 }}>
          거리: {Math.round(distance)}m 
          위도: {latitude}
          경도: {longitude}
        </Text>
      )}
    </View>
  );
}

/* ===============================
   3️⃣ 거리 계산 함수
================================ */
function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(a));
}
