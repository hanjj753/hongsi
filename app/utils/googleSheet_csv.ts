// app/utils/googleSheet_csv.ts
import { Platform } from "react-native";

function stripBOM(s: string) {
  return s.replace(/^\uFEFF/, "");
}

function parseCSV(text: string) {
  // simple CSV parser that handles quotes
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (ch === '"') {
      // handle escaped quotes
      if (inQuotes && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      row.push(cur);
      cur = "";
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      cur = "";
      if (row.some((x) => x.length > 0)) rows.push(row);
      row = [];
    } else {
      cur += ch;
    }
  }
  row.push(cur);
  if (row.some((x) => x.length > 0)) rows.push(row);

  return rows;
}

export async function fetchSheetData(url: string) {
  // ✅ On web, force no-store to reduce weird caching / redirects
  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "text/csv" },
    ...(Platform.OS === "web" ? { cache: "no-store" as RequestCache } : {}),
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}\n${text.slice(0, 200)}`);
  }

  // Detect "not actually CSV" (Google sometimes returns HTML login page)
  const sniff = text.slice(0, 200).toLowerCase();
  if (sniff.includes("<!doctype html") || sniff.includes("<html")) {
    throw new Error(
      `Not CSV. Google returned HTML (likely not published / wrong URL / permission).\nFirst 200 chars:\n${text.slice(
        0,
        200
      )}`
    );
  }

  const grid = parseCSV(stripBOM(text));
  if (grid.length < 1) return [];

  const headers = grid[0].map((h) => stripBOM(String(h ?? "")).trim());
  const out = grid.slice(1).map((vals) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = String(vals[i] ?? "").trim();
    });
    return obj;
  });

  return out;
}
