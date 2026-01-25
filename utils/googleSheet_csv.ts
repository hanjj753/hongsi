// csv를 2차원 배열로 파싱하고, 객체 배열로 변환하는 유틸리티 함수
import { Platform } from "react-native";
import { CLASS_SHEET_HEADERS, CLASS_SHEET_HEADER_ROW } from "../config/sheetConfig"; 

/**
 * 문자열 맨 앞의 BOM(Byte Order Mark) 특수문자를 제거합니다.
 */
function stripBOM(s: string): string {
  return s.replace(/^\uFEFF/, "");
}

/**
 * CSV 문자열을 2차원 배열로 변환합니다.
 * 따옴표(")로 감싸진 데이터 내의 콤마(,)나 줄바꿈을 올바르게 처리합니다.
 */
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (ch === '"') {
      // 따옴표 이스케이프 처리 ("" -> ")
      if (inQuotes && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      // 콤마: 셀 구분
      row.push(cur);
      cur = "";
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      // 줄바꿈: 행 구분 (\r\n 처리 포함)
      if (ch === "\r" && text[i + 1] === "\n") i++;
      
      row.push(cur);
      cur = "";
      
      // 빈 줄이 아니면 추가
      if (row.some((x) => x.length > 0)) rows.push(row);
      row = [];
    } else {
      cur += ch;
    }
  }
  
  // 마지막 데이터 처리
  row.push(cur);
  if (row.some((x) => x.length > 0)) rows.push(row);

  return rows;
}

/**
 * 구글 시트의 CSV 발행 URL에서 데이터를 가져와 JSON 배열로 반환합니다.
 * * @param url - 구글 시트 CSV URL (pub?output=csv)
 * @returns 객체 배열 (헤더 이름이 키가 됨)
 */
export async function fetchSheetData(url: string): Promise<Record<string, string>[]> {
  // 웹에서 캐싱 문제로 이전 데이터가 계속 나오는 것을 방지 (no-store)
  const fetchOptions: RequestInit = {
    method: "GET",
    headers: { Accept: "text/csv" },
    ...(Platform.OS === "web" ? { cache: "no-store" } : {}),
  };

  const res = await fetch(url, fetchOptions);
  const text = await res.text();

  if (!res.ok) {
    throw new Error(`HTTP Error ${res.status}: ${text.slice(0, 100)}`);
  }

  // 구글 로그인 페이지(HTML)가 반환되는 경우 감지 (권한 없음/URL 오류)
  const sniff = text.slice(0, 200).toLowerCase();
  if (sniff.includes("<!doctype html") || sniff.includes("<html")) {
    throw new Error("CSV가 아닌 HTML이 반환되었습니다. 시트가 '웹에 게시' 되었는지 확인해주세요.");
  }

  // 파싱 시작
  const grid = parseCSV(stripBOM(text));
  if (grid.length < 1) return [];

  // 첫 줄을 헤더(Key)로 사용
  const headers = grid[0].map((h) => stripBOM(String(h ?? "")).trim());
  
  // 두 번째 줄부터 데이터로 변환
  const result = grid.slice(1).map((vals) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      // 값이 없으면 빈 문자열 처리
      obj[h] = String(vals[i] ?? "").trim();
    });
    return obj;
  });

  return result;
}

export async function fetchClassSheet(url: string): Promise<Record<string, string>[]> {
  const fetchOptions: RequestInit = {
    method: "GET",
    headers: { Accept: "text/csv" },
    ...(Platform.OS === "web" ? { cache: "no-store" } : {}),
  };

  try {
    const res = await fetch(url, fetchOptions);
    const text = await res.text();

    if (!res.ok) throw new Error(`HTTP Error ${res.status}`);

    const sniff = text.slice(0, 200).toLowerCase();
    if (sniff.includes("<!doctype html") || sniff.includes("<html")) {
      throw new Error("HTML 반환됨 (웹 게시 확인 필요)");
    }

    // 기존 parseCSV 재활용 (안전함)
    const grid = parseCSV(stripBOM(text));
    
    // 헤더 행 인덱스 계산 (5행 -> index 4)
    const headerRowIndex = (CLASS_SHEET_HEADER_ROW || 5) - 1;

    if (grid.length <= headerRowIndex) return [];

    // 헤더 추출
    const headers = grid[headerRowIndex].map((h) => stripBOM(String(h ?? "")).trim());

    // 데이터 추출 (헤더 다음 행부터)
    const result = grid.slice(headerRowIndex + 1).map((vals) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => {
        obj[h] = String(vals[i] ?? "").trim();
      });
      return obj;
    });

    // ID가 있는 유효한 행만 필터링해서 반환
    return result.filter(r => r[CLASS_SHEET_HEADERS.ID]);

  } catch (e) {
    console.error("[fetchClassSheet] Error:", e);
    return [];
  }
}

export async function fetchClassSheetRaw(url: string): Promise<string[][]> {
  const fetchOptions: RequestInit = {
    method: "GET",
    headers: { Accept: "text/csv" },
    ...(Platform.OS === "web" ? { cache: "no-store" } : {}),
  };

  try {
    const res = await fetch(url, fetchOptions);
    const text = await res.text();

    if (!res.ok) throw new Error(`HTTP Error ${res.status}`);

    // 기존 parseCSV 재활용
    const grid = parseCSV(stripBOM(text));
    
    // 헤더 행 인덱스 (설정값 사용, 없으면 기본값 5 -> 인덱스 4)
    const headerRowIndex = (CLASS_SHEET_HEADER_ROW || 5) - 1;

    if (grid.length <= headerRowIndex + 1) return [];

    // 헤더 행 다음부터 끝까지 데이터만 잘라서 반환
    return grid.slice(headerRowIndex + 1);

  } catch (e) {
    console.error("[fetchClassSheetRaw] Error:", e);
    return [];
  }
}