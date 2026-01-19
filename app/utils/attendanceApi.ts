// utils/attendanceApi.ts
import { Platform } from "react-native";

export async function postAttendance(url: string, payload: any) {
  const body = JSON.stringify(payload);

  // ✅ Web(브라우저)에서는 CORS 때문에 응답을 못 읽는 경우가 많아서 no-cors로 보냄
  if (Platform.OS === "web") {
    await fetch(url, {
      method: "POST",
      mode: "no-cors", // ✅ CORS 차단 회피(응답은 opaque)
      headers: {
        "Content-Type": "text/plain;charset=utf-8", // ✅ preflight(OPTIONS) 방지
      },
      body,
    });

    // 웹에서는 응답(JSON)을 못 받아도 서버에는 요청이 들어가서 시트에 append 될 수 있음
    return { ok: true, webOpaque: true };
  }

  // ✅ Native(iOS/Android)는 정상 JSON 통신 가능
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: res.ok, raw: text };
  }
}