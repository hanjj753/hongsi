/* 조교 권한 관리 시트 Google Apps Script*/

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({ status: "alive" })).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(10000);

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const body = JSON.parse(e.postData.contents);
    const targetSheetName = body.sheetName;
    const action = body.action;

    if (!targetSheetName) return errorResponse("시트 이름(sheetName)이 없습니다.");

    const sheet = ss.getSheetByName(targetSheetName);
    if (!sheet) return errorResponse("시트를 찾을 수 없습니다: " + targetSheetName);

    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const colMap = {};
    headers.forEach((h, i) => colMap[h] = i + 1);

    // ==========================================
    // [기능 1] 유저 자동 등록 & Device ID 업데이트
    // ==========================================
    if (action === "register_user") {
      const emailCol = colMap["이메일"];
      const deviceIdCol = colMap["Device ID"];

      if (!emailCol || !deviceIdCol) return errorResponse("필수 열(이메일, Device ID)이 없습니다.");

      const userEmail = String(body.email || "").trim();
      const userName = body.name || "";
      const newDeviceId = String(body.deviceId || "").trim(); // 앱에서 보낸 ID
      
      const lastRow = sheet.getLastRow();
      let foundRow = -1;

      // 1. 이메일로 기존 유저 찾기
      if (lastRow > 1) {
        const emailData = sheet.getRange(2, emailCol, lastRow - 1, 1).getValues();
        for (let i = 0; i < emailData.length; i++) {
          if (String(emailData[i][0]).trim() === userEmail) {
            foundRow = i + 2; // 실제 행 번호 (헤더가 1행이므로 데이터는 2행부터)
            break;
          }
        }
      }

      // 2. 분기 처리
      if (foundRow > 0) {
        // [Case A] 이미 유저가 있는 경우
        const currentDeviceId = String(sheet.getRange(foundRow, deviceIdCol).getValue()).trim();

        // 핵심 로직: 시트엔 ID가 없는데, 앱이 ID를 들고 왔다면? -> 업데이트!
        if (currentDeviceId === "" && newDeviceId !== "") {
          sheet.getRange(foundRow, deviceIdCol).setValue(newDeviceId);
          return successResponse("기존 유저의 Device ID를 등록했습니다.");
        } else {
          return successResponse("이미 등록된 유저입니다. (변경 없음)");
        }

      } else {
        // [Case B] 아예 없는 유저인 경우 -> 신규 등록
        const newRow = headers.map(h => {
          if (h === "이름") return userName;
          if (h === "이메일") return userEmail;
          if (h === "권한") return "Assistant"; // 기본 권한
          if (h === "Device ID") return newDeviceId;
          if (h === "상태") return "승인";      // 기본 상태
          return "";
        });
        sheet.appendRow(newRow);
        return successResponse("신규 유저 등록 완료");
      }
    }

    // ==========================================
    // [기능 2] 관리자가 권한 직접 부여 (Admin/Manager 추가)
    // ==========================================
    if (action === "update_permission") {
      const emailCol = colMap["이메일"];
      const roleCol = colMap["권한"];
      const statusCol = colMap["상태"];

      if (!emailCol || !roleCol) return errorResponse("필수 열(이메일, 권한)이 없습니다.");

      const targetEmail = String(body.targetEmail || "").trim();
      const targetRole = body.targetRole; // "Admin" or "Manager"

      if (!targetEmail || !targetRole) return errorResponse("이메일과 권한 정보가 필요합니다.");

      const lastRow = sheet.getLastRow();
      let foundRow = -1;

      // 1. 이메일로 유저 찾기
      if (lastRow > 1) {
        const emailData = sheet.getRange(2, emailCol, lastRow - 1, 1).getValues();
        for (let i = 0; i < emailData.length; i++) {
          if (String(emailData[i][0]).trim() === targetEmail) {
            foundRow = i + 2;
            break;
          }
        }
      }

      // 2. 있으면 권한 수정, 없으면 새로 추가
      if (foundRow > 0) {
        sheet.getRange(foundRow, roleCol).setValue(targetRole);
        return successResponse(`[수정 완료] ${targetEmail} -> ${targetRole}`);
      } else {
        // 새로 추가 (이름은 모름)
        const newRow = headers.map(h => {
          if (h === "이메일") return targetEmail;
          if (h === "권한") return targetRole;
          if (h === "상태") return "승인"; // 관리자가 직접 추가하므로 바로 승인
          if (h === "이름") return "초대된 유저";
          return "";
        });
        sheet.appendRow(newRow);
        return successResponse(`[신규 추가] ${targetEmail} -> ${targetRole}`);
      }
    }

    // ==========================================
    // [기능 3] 조교 정보 시트에 데이터 추가 (Admin/Manager용)
    // ==========================================
    if (action === "add_assistant") {
      // 1. 헤더 맵핑 (조교 정보 시트의 헤더를 찾음)
      // sheet는 body.sheetName으로 받아온 시트("조교 정보")를 가리킴
      
      const newAssistantData = [
        body.position || "",   // 직책 (CEO, 실장, 조교 등)
        body.name || "",       // 성명
        body.phone || "",      // 전화번호
        body.email || "",      // gmail
        body.role || "",       // 역할 (현장, 자료 등)
        body.startDate || "",  // 근무 시작
        body.account || "",    // 계좌번호
        body.status || ""      // 비고
      ];

      // 2. 데이터 추가 (appendRow)
      // 주의: 위 순서는 시트의 열 순서(A, B, C...)와 정확히 일치해야 합니다.
      // A:직책, B:성명, C:전화번호, D:gmail, E:역할, F:근무 시작, G:계좌번호, H:비고
      
      sheet.appendRow(newAssistantData);
      
      return successResponse("조교 정보를 추가했습니다.");
    }

    // ==========================================
    // [기능 4] 문의 등록 (수정됨: 순차 ID 부여)
    // ==========================================
    if (action === "submit_inquiry") {
      // 수정된 ID 생성 로직: (현재 전체 행 개수) = (마지막 행 번호)
      // 예: 헤더만 있으면 1행 -> ID는 1
      // 예: 데이터가 9개 있으면 10행 -> ID는 10
      const seqId = sheet.getLastRow(); 

      const newRow = headers.map(header => {
        if (header === "ID") return seqId; // 순차 번호 저장
        if (header.includes("이름")) return body.name || "";
        if (header.includes("이메일")) return body.email || "";
        if (header.includes("내용")) return body.content || "";
        if (header.includes("날짜") || header.includes("일시")) {
          return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
        }
        if (header.includes("상태")) return "X"; 
        return "";
      });

      sheet.appendRow(newRow);
      return successResponse("문의가 정상적으로 접수되었습니다.");
    }

    // ==========================================
    // [기능 5] 문의 상태 변경 (수정됨: 숫자/문자 비교 호환)
    // ==========================================
    if (action === "solve_inquiry") {
      const idCol = colMap["ID"];     
      const statusCol = colMap["상태"]; 

      if (!idCol || !statusCol) return errorResponse("필수 열(ID, 상태)을 찾을 수 없습니다.");

      const targetId = String(body.id || "").trim(); // 앱에서 보낸 ID (문자열 변환)
      
      const data = sheet.getDataRange().getValues();
      let updated = false;

      // 헤더 제외하고 데이터 검색
      for (let i = 1; i < data.length; i++) {
        // 시트에 저장된 ID가 숫자일 수도 있고 문자일 수도 있으므로 String으로 변환하여 비교
        const rowId = String(data[i][idCol - 1]).trim();

        if (rowId === targetId) {
          sheet.getRange(i + 1, statusCol).setValue("O"); 
          updated = true;
          break; 
        }
      }

      if (updated) return successResponse("상태가 변경되었습니다.");
      return errorResponse(`ID가 일치하는 문의를 찾을 수 없습니다: ${targetId}`);
    }

    return errorResponse("알 수 없는 액션입니다: " + action);

  } catch (e) {
    return errorResponse(e.toString());
  } finally {
    lock.releaseLock();
  }
}

function successResponse(msg) {
  return ContentService.createTextOutput(JSON.stringify({ result: "success", message: msg })).setMimeType(ContentService.MimeType.JSON);
}

function errorResponse(msg) {
  return ContentService.createTextOutput(JSON.stringify({ result: "error", message: msg })).setMimeType(ContentService.MimeType.JSON);
}