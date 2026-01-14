export async function postAttendance(url: string, data: any) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8", // best compatibility with GAS
      "Accept": "application/json",
    },
    body: JSON.stringify(data),
  });

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Invalid response from Apps Script: " + text);
  }
}
