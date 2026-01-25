// 앱과 구글 시트(GAS) 간의 데이터 통신 유틸리티
import { Platform } from "react-native";

interface ApiResponse<T = any> {
  ok: boolean;
  data?: T;
  message?: string;
  error?: string;
  webOpaque?: boolean;
}

/**
 * 1. 데이터 조회 (GET)
 * GAS의 doGet(e)와 통신합니다. (?sheet=시트이름)
 * * @param scriptUrl - Apps Script 배포 URL (exec)
 * @param sheetName - 데이터를 가져올 시트(탭) 이름
 */
export async function getSheetData<T = any>(scriptUrl: string, sheetName: string): Promise<ApiResponse<T[]>> {
  try {
    // URL에 파라미터 추가 (?sheet=이름)
    const targetUrl = `${scriptUrl}?sheet=${encodeURIComponent(sheetName)}`;
    
    // 웹 환경 캐시 방지 옵션
    const options: RequestInit = {
      method: "GET",
      headers: { "Accept": "application/json" },
      ...(Platform.OS === "web" ? { cache: "no-store" } : {}),
    };

    const res = await fetch(targetUrl, options);
    const text = await res.text();

    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 100)}` };
    }

    // JSON 파싱
    const json = JSON.parse(text);

    // GAS에서 { error: ... }를 보낸 경우 처리
    if (json.error) {
      return { ok: false, error: json.error };
    }

    return { ok: true, data: json };

  } catch (err: any) {
    console.error("[GET Error]", err);
    return { ok: false, error: err.message };
  }
}

/**
 * 2. 데이터 저장 (POST)
 * GAS의 doPost(e)와 통신합니다. (body: { sheetName, ...data })
 * * @param scriptUrl - Apps Script 배포 URL (exec)
 * @param sheetName - 저장할 시트(탭) 이름
 * @param payload - 저장할 데이터 객체 (헤더 이름과 Key가 일치해야 함)
 */
export async function postSheetData(scriptUrl: string, sheetName: string, payload: Record<string, any>): Promise<ApiResponse> {
  // GAS 요구사항: body 안에 sheetName이 있어야 함
  const bodyData = {
    sheetName: sheetName,
    ...payload
  };

  const body = JSON.stringify(bodyData);

  // 🌐 [Web] 브라우저 CORS 회피
  if (Platform.OS === "web") {
    await fetch(scriptUrl, {
      method: "POST",
      mode: "no-cors", // 응답 내용을 읽지 않음 (Opaque Response)
      headers: {
        "Content-Type": "text/plain;charset=utf-8", // Preflight 방지
      },
      body,
    });

    // 웹에서는 응답을 읽을 수 없으므로 전송 시도 자체를 성공으로 간주
    return { ok: true, webOpaque: true, message: "데이터 전송 요청 완료 (Web)" };
  }

  // 📱 [Native] 정상 JSON 통신
  try {
    const res = await fetch(scriptUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // GAS 호환성
      body,
    });

    const text = await res.text();
    
    try {
      const json = JSON.parse(text);
      if (json.result === "error" || json.error) {
        return { ok: false, error: json.message || json.error };
      }
      return { ok: true, data: json };
    } catch {
      // JSON 파싱 실패 시
      return { ok: res.ok, message: text };
    }
  } catch (err: any) {
    console.error("[POST Error]", err);
    return { ok: false, error: err.message };
  }
}