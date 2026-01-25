// 위치 정보 파싱 및 매핑 유틸리티
import { fetchSheetData } from "./googleSheet_csv";

type LatLon = { lat: number; lon: number };

/**
 * "37.1234, 127.5678" 형태의 문자열을 파싱하여 좌표 객체로 반환합니다.
 */
export function parseCoordinate(coord: any): LatLon | null {
  const raw = String(coord ?? "").trim();
  if (!raw) return null;

  // 괄호가 있다면 제거하고, 콤마로 분리
  const cleaned = raw.replace(/[()]/g, ""); 
  const parts = cleaned.split(",").map(s => s.trim());
  
  if (parts.length < 2) return null;

  const lat = Number(parts[0]);
  const lon = Number(parts[1]);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  return { lat, lon };
}

/**
 * 위치 CSV를 읽어와서 { "장소명": "위도,경도" } 형태의 Map을 만듭니다.
 * * @param csvUrl - 위치 정보가 담긴 CSV URL
 */
export async function loadPositionMap(csvUrl: string): Promise<Map<string, string>> {
  const rows = await fetchSheetData(csvUrl);
  const map = new Map<string, string>();

  rows.forEach((r) => {
    // CSV 헤더가 "position" 또는 "Position" 등으로 다양할 수 있어 대비
    const key = String(r["position"] ?? r["Position"] ?? r["장소"] ?? "").trim();
    const coord = String(r["coordinate"] ?? r["Coordinate"] ?? r["좌표"] ?? "").trim();
    
    if (key && coord) {
      map.set(key, coord);
    }
  });

  return map;
}