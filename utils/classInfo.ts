// 수업 생성 시트에서 수업 ID로 시트 URL과 마스터 시트 URL을 조회하는 유틸 함수
import { fetchSheetData } from "./googleSheet_csv";
import { CSV_URLS, CLASSES_HEADERS } from "../config/sheetConfig";

/**
 * 수업 ID(classId)를 기반으로 해당 수업의 시트 URL과 마스터 시트 URL을 찾습니다.
 * * @param targetId - 찾고자 하는 수업 ID (예: "C01")
 * @returns {Promise<{ sheetUrl: string, masterSheetUrl: string } | null>}
 */
export async function getClassUrls(targetId: string) {
  try {
    // 1. 수업 목록 CSV 데이터를 가져옵니다. (CSV_URLS 이용)
    const rows = await fetchSheetData(CSV_URLS.CLASSES);
    
    // 2. Class ID가 일치하는 행을 찾습니다.
    const foundRow = rows.find(
      (row) => String(row[CLASSES_HEADERS.CLASS_ID] ?? "").trim() === targetId
    );

    if (foundRow) {
      return {
        // sheetConfig에 정의된 헤더 키를 사용해 안전하게 값을 꺼냅니다.
        sheetUrl: foundRow[CLASSES_HEADERS.SHEET_URL] || "",
        masterSheetUrl: foundRow[CLASSES_HEADERS.MASTER_SHEET_URL] || ""
      };
    }
    
    // 3. 찾지 못한 경우 null 반환
    return null;
  } catch (error) {
    console.error("[getClassUrls Error]", error);
    // 에러 발생 시 null을 반환하거나, 필요 시 throw error
    return null;
  }
}