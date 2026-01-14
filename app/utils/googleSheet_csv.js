// utils/googleSheet.js
import Papa from "papaparse";

/**
 * Fetch Google Sheet published as CSV
 * @param {string} csvUrl - Published CSV URL
 * @returns {Promise<Array<Object>>}
 */
export const fetchSheetData = async (csvUrl) => {
  try {
    // ✅ cache-buster to always get latest data
    const url = `${csvUrl}${csvUrl.includes("?") ? "&" : "?"}t=${Date.now()}`;

    const response = await fetch(url, {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const csvText = await response.text();

    const parsed = Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      encoding: "utf-8", // Korean-safe
    });

    return parsed.data || [];
  } catch (error) {
    console.error("[CSV Fetch Error]:", error);
    throw error;
  }
};
