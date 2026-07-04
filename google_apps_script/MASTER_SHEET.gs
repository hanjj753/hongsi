/* 마스터 시트 Google Apps Script*/

function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. URL 파라미터에서 시트 이름 가져오기 (?sheet=공지사항)
  const targetSheetName = e.parameter.sheet;

  if (!targetSheetName) {
    return ContentService.createTextOutput(JSON.stringify({ error: "파라미터(sheet)가 없습니다." }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const sheet = ss.getSheetByName(targetSheetName);
  
  if (!sheet) {
    return ContentService.createTextOutput(JSON.stringify({ error: "해당 이름의 시트를 찾을 수 없습니다." }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const data = sheet.getDataRange().getValues();
  const headers = data.shift(); // 첫 줄(헤더) 빼기
  
  // 2. JSON 형태로 변환
  const json = data.map(row => {
    const obj = {};
    headers.forEach((header, i) => {
      // 날짜 데이터는 문자열로 변환해줘야 앱에서 안 깨집니다
      if (row[i] instanceof Date) {
        obj[header] = row[i].toLocaleString();
      } else {
        obj[header] = row[i];
      }
    });
    return obj;
  });

  return ContentService.createTextOutput(JSON.stringify(json))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. 앱에서 보낸 JSON 데이터 파싱
  const body = JSON.parse(e.postData.contents);
  
  // 2. 저장할 시트 찾기 (앱에서 "sheetName": "마스터 시트 생성용" 처럼 보내줘야 함)
  const targetSheetName = body.sheetName;

  if (!targetSheetName) {
    return ContentService.createTextOutput(JSON.stringify({ error: "파라미터(sheet)가 없습니다." }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const sheet = ss.getSheetByName(targetSheetName);

  if (!sheet) {
    return ContentService.createTextOutput(JSON.stringify({ result: "error", message: "시트를 찾을 수 없습니다." }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  // 3. 시트의 헤더(1행) 가져오기
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  
  // 4. 헤더 이름에 맞춰서 데이터 배열 생성
  const newRow = headers.map(header => {
    // 앱에서 보낸 키값과 헤더가 일치하면 그 값을 넣고, 없으면 빈칸
    return body[header] || ""; 
  });
  
  // 5. 행 추가
  sheet.appendRow(newRow);
  
  return ContentService.createTextOutput(JSON.stringify({ result: "success" }))
    .setMimeType(ContentService.MimeType.JSON);
}