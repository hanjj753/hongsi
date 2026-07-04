/* [조교 출석 및 메시지 통합 관리 스크립트] */

function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. URL 파라미터에서 시트 이름 가져오기 (?sheet=메시지 log)
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
  if (data.length < 1) return ContentService.createTextOutput(JSON.stringify([])).setMimeType(ContentService.MimeType.JSON);

  const headers = data.shift(); // 첫 줄(헤더) 빼기
  
  // 2. JSON 형태로 변환
  const json = data.map(row => {
    const obj = {};
    headers.forEach((header, i) => {
      // 날짜 데이터는 문자열로 변환해줘야 앱에서 안 깨집니다
      if (row[i] instanceof Date) {
        obj[header] = Utilities.formatDate(row[i], Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
      } else {
        obj[header] = String(row[i]);
      }
    });
    return obj;
  });

  return ContentService.createTextOutput(JSON.stringify(json))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(10000);

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const body = JSON.parse(e.postData.contents);
    const targetSheetName = body.sheetName;
    const action = body.action || "append"; 

    if (!targetSheetName) {
      return ContentService.createTextOutput(JSON.stringify({ result: "error", message: "파라미터(sheetName)가 없습니다." })).setMimeType(ContentService.MimeType.JSON);
    }

    const sheet = ss.getSheetByName(targetSheetName);
    if (!sheet) {
      return ContentService.createTextOutput(JSON.stringify({ result: "error", message: "시트를 찾을 수 없습니다." })).setMimeType(ContentService.MimeType.JSON);
    }

    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const colMap = {};
    headers.forEach((h, i) => colMap[h] = i + 1);

    // ==========================================
    // [CASE 1] 상태 업데이트 (특정 수업 ID만!)
    // ==========================================
    if (action === "update_status") {
      const targetClassId = body.classId; // 앱에서 받은 수업 ID
      
      const statusCol = colMap["상태"]; 
      const classIdCol = colMap["수업 ID"]; // 주의: 시트 헤더가 "수업 ID"여야 함 (띄어쓰기 포함)

      if (!statusCol || !classIdCol) {
        return ContentService.createTextOutput(JSON.stringify({ result: "error", message: "'상태' 또는 '수업 ID' 열을 찾을 수 없습니다." })).setMimeType(ContentService.MimeType.JSON);
      }

      const lastRow = sheet.getLastRow();
      if (lastRow < 2) {
        return ContentService.createTextOutput(JSON.stringify({ result: "success", count: 0 })).setMimeType(ContentService.MimeType.JSON);
      }

      // 전체 데이터 읽기 (속도 최적화)
      const range = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn());
      const values = range.getValues();
      let updateCount = 0;

      // 0부터 시작하는 배열 인덱스로 변환
      const sIdx = statusCol - 1;
      const cIdx = classIdCol - 1;

      for (let i = 0; i < values.length; i++) {
        const rowClassId = String(values[i][cIdx]);
        const rowStatus = String(values[i][sIdx]);
        
        // 수업 ID가 일치하고 + 상태가 'unsent'인 경우만
        if (rowClassId === String(targetClassId) && rowStatus === "unsent") {
          values[i][sIdx] = "sent"; // 메모리 상에서 값 변경
          updateCount++;
        }
      }

      // 변경된 내용이 있으면 시트에 반영 (상태 열만 덮어쓰기)
      if (updateCount > 0) {
        // map을 써서 상태값만 추출한 2차원 배열 생성
        const newStatuses = values.map(r => [r[sIdx]]);
        sheet.getRange(2, statusCol, lastRow - 1, 1).setValues(newStatuses);
      }

      return ContentService.createTextOutput(JSON.stringify({ result: "success", count: updateCount })).setMimeType(ContentService.MimeType.JSON);
    } 
    
    // ==========================================
    // [CASE 2] 대기 중인(unsent) 문자 일괄 삭제 (추가된 기능)
    // ==========================================
    else if (action === "delete_unsent_messages") {
      const targetClassId = body.classId;
      const statusCol = colMap["상태"];
      const classIdCol = colMap["수업 ID"]; // 또는 colMap["수업ID"] 확인 필요

      if (!statusCol || !classIdCol) {
        return ContentService.createTextOutput(JSON.stringify({ result: "error", message: "'상태' 또는 '수업 ID' 열을 찾을 수 없습니다." })).setMimeType(ContentService.MimeType.JSON);
      }

      // 전체 데이터 가져오기
      const data = sheet.getDataRange().getValues();
      let deleteCount = 0;

      // 행 삭제는 인덱스 밀림 방지를 위해 반드시 '뒤에서부터' 반복해야 함
      // data[0]은 헤더이므로 i >= 1 까지 반복
      for (let i = data.length - 1; i >= 1; i--) {
        const rowClassId = String(data[i][classIdCol - 1]);
        const rowStatus = String(data[i][statusCol - 1]);

        if (rowClassId === String(targetClassId) && rowStatus === "unsent") {
          sheet.deleteRow(i + 1); // deleteRow는 1부터 시작하는 행 번호 사용
          deleteCount++;
        }
      }
      
      return ContentService.createTextOutput(JSON.stringify({ result: "success", count: deleteCount })).setMimeType(ContentService.MimeType.JSON);
    }

    // ==========================================
    // [CASE 3] 데이터 추가 (기본)
    // ==========================================
    const newRow = headers.map(header => body[header] || "");
    sheet.appendRow(newRow);
    
    return ContentService.createTextOutput(JSON.stringify({ result: "success" })).setMimeType(ContentService.MimeType.JSON);

  } catch (e) {
    return ContentService.createTextOutput(JSON.stringify({ result: "error", message: e.toString() })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}