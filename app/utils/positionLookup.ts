import { fetchSheetData } from "./googleSheet_csv";

type Row = Record<string, any>;

export function parseCoordinate(coord: any): { lat: number; lon: number } | null {
  const raw = String(coord ?? "").trim();
  if (!raw) return null;

  // accepts: "37.1,127.2" (with possible spaces)
  const parts = raw.split(",").map(s => s.trim());
  if (parts.length < 2) return null;

  const lat = Number(parts[0]);
  const lon = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  return { lat, lon };
}

export async function loadPositionMap(POSITIONS_CSV_URL: string) {
  const rows = await fetchSheetData(POSITIONS_CSV_URL);

  // map: position -> "lat,lon"
  const map = new Map<string, string>();

  (rows || []).forEach((r: Row) => {
    const key = String(r["position"] ?? r["Position"] ?? "").trim();
    const coord = String(r["coordinate"] ?? r["Coordinate"] ?? "").trim();
    if (key && coord) map.set(key, coord);
  });

  return map;
}
