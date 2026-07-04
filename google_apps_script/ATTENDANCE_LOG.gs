/* 조교 근무 관리 시트 Google Apps Script*/

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(10000);

  try {
    var doc = SpreadsheetApp.getActiveSpreadsheet();
    var params = JSON.parse(e.postData.contents);
    var action = params.action || "checkin";

    // ==========================================
    // [기능 4] 수업 일정 관리 (추가 / 수정 / 삭제)
    // ==========================================
    if (action === "add_class_schedule" || action === "update_class_schedule" || action === "delete_class_schedule") {
      var scheduleSheet = doc.getSheetByName("전체_수업_일정");
      if (!scheduleSheet) {
        return ContentService.createTextOutput(JSON.stringify({ "result": "error", "error": "'전체_수업_일정' 시트를 찾을 수 없습니다." })).setMimeType(ContentService.MimeType.JSON);
      }

      var rows = scheduleSheet.getDataRange().getValues();
      var foundIndex = -1;

      if (action !== "add_class_schedule") {
        for (var i = 1; i < rows.length; i++) {
          if (String(rows[i][0]) === String(params.classId) && String(rows[i][4]) === String(params.session)) {
            foundIndex = i + 1;
            break;
          }
        }
        if (foundIndex === -1) {
          return ContentService.createTextOutput(JSON.stringify({ "result": "error", "message": "해당 차시를 찾을 수 없습니다." })).setMimeType(ContentService.MimeType.JSON);
        }
      }

      if (action === "delete_class_schedule") {
        scheduleSheet.deleteRow(foundIndex);
        return ContentService.createTextOutput(JSON.stringify({ "result": "success", "message": "일정이 삭제되었습니다." })).setMimeType(ContentService.MimeType.JSON);
      } 
      
      else if (action === "update_class_schedule") {
        // ✅ [수정] 날짜 앞에 ' 붙여서 텍스트 강제
        scheduleSheet.getRange(foundIndex, 6).setValue("'" + params.date);
        scheduleSheet.getRange(foundIndex, 7).setValue(params.workers);
        scheduleSheet.getRange(foundIndex, 8).setValue(params.note);
        return ContentService.createTextOutput(JSON.stringify({ "result": "success", "message": "일정이 수정되었습니다." })).setMimeType(ContentService.MimeType.JSON);
      } 
      
      else {
        // ✅ [수정] 날짜 앞에 ' 붙여서 텍스트 강제
        var newScheduleRow = [
          params.classId || "",      
          params.quarter || "",      
          params.className || "",    
          params.day || "",          
          params.session || "",      
          "'" + (params.date || ""), // 날짜       
          params.workers || "",      
          params.note || ""
        ];
        scheduleSheet.appendRow(newScheduleRow);
        return ContentService.createTextOutput(JSON.stringify({ "result": "success", "message": "일정이 추가되었습니다." })).setMimeType(ContentService.MimeType.JSON);
      }
    }

    // ==========================================
    // [기능 5] 근무 기록 수정 (✅ 텍스트 강제 변환 적용)
    // ==========================================
    if (action === "update_attendance_log") {
      var sheet = doc.getSheetByName("조교_출석_현황");
      if (!sheet) return ContentService.createTextOutput(JSON.stringify({ "result": "error", "error": "시트를 찾을 수 없습니다." })).setMimeType(ContentService.MimeType.JSON);
      
      var data = sheet.getDataRange().getValues();
      var headers = data[0];
      var colMap = {};
      headers.forEach(function(h, i) { colMap[String(h).trim()] = i; }); // 헤더 공백 제거 매핑

      // 앱에서 보낸 데이터
      var targetDate = String(params.targetDate || "").trim();
      var targetEmail = String(params.targetEmail || "").trim().toLowerCase();
      var targetClass = String(params.targetClass || "").trim();
      var oldStart = String(params.oldStart || "").trim();
      var oldEnd = String(params.oldEnd || "").trim();

      var foundRow = -1;

      // 행 순회
      for (var i = 1; i < data.length; i++) {
        // 1. 날짜 비교 (Date 객체 or String)
        var rowDateRaw = data[i][colMap["근무 일자"]];
        var rowDateStr = "";
        if (rowDateRaw instanceof Date) {
           rowDateStr = Utilities.formatDate(rowDateRaw, Session.getScriptTimeZone(), "yyyy-MM-dd");
        } else {
           rowDateStr = String(rowDateRaw).trim();
        }

        // 2. 이메일 & 수업명 비교
        var rowEmail = String(data[i][colMap["출근자 Email"]] || "").trim().toLowerCase();
        var rowClass = String(data[i][colMap["수업"]] || "").trim();

        // 3. 기존 시간 비교
        var rowStartRaw = data[i][colMap["출근 시간"]];
        var rowStartStr = (rowStartRaw instanceof Date) ? Utilities.formatDate(rowStartRaw, Session.getScriptTimeZone(), "HH:mm") : String(rowStartRaw).trim();
        var rowEndRaw = data[i][colMap["퇴근 시간"]];
        var rowEndStr = (rowEndRaw instanceof Date) ? Utilities.formatDate(rowEndRaw, Session.getScriptTimeZone(), "HH:mm") : String(rowEndRaw).trim();

        if (rowDateStr === targetDate && 
            rowEmail === targetEmail && 
            rowClass === targetClass &&
            rowStartStr === oldStart && 
            rowEndStr === oldEnd) {
          
          foundRow = i + 1;
          break; 
        }
      }

      if (foundRow !== -1) {
        // ✅ [수정] 값 업데이트 시 ' 붙여서 텍스트 강제
        if (colMap["출근 시간"] !== undefined) sheet.getRange(foundRow, colMap["출근 시간"] + 1).setValue("'" + params.newStart);
        if (colMap["퇴근 시간"] !== undefined) sheet.getRange(foundRow, colMap["퇴근 시간"] + 1).setValue("'" + params.newEnd);
        if (colMap["근무 시간"] !== undefined) sheet.getRange(foundRow, colMap["근무 시간"] + 1).setValue("'" + params.newDuration);
        
        // 상태 변경
        if (colMap["상태"] !== undefined) sheet.getRange(foundRow, colMap["상태"] + 1).setValue("퇴근");

        return ContentService.createTextOutput(JSON.stringify({ "result": "success" })).setMimeType(ContentService.MimeType.JSON);
      } else {
        return ContentService.createTextOutput(JSON.stringify({ 
          "result": "error", 
          "error": "일치하는 기록을 찾을 수 없습니다."
        })).setMimeType(ContentService.MimeType.JSON);
      }
    }

    // ==========================================
    // [기능 6] 수업 장소 관리 (추가 / 수정 / 삭제) - 신규 추가
    // ==========================================
    if (action === "add_location" || action === "update_location" || action === "delete_location") {
      var posSheet = doc.getSheetByName("수업_장소들"); // 시트 이름 확인 필수
      if (!posSheet) {
        return ContentService.createTextOutput(JSON.stringify({ "result": "error", "error": "'수업_장소들' 시트를 찾을 수 없습니다." })).setMimeType(ContentService.MimeType.JSON);
      }

      var posRows = posSheet.getDataRange().getValues();
      var posFoundIndex = -1;
      var targetPlace = String(params.place || "").trim(); // 장소명을 식별자로 사용

      // 수정/삭제 시 대상 행 찾기 (A열: 장소명 기준)
      if (action !== "add_location") {
        for (var i = 1; i < posRows.length; i++) {
          if (String(posRows[i][0]).trim() === targetPlace) {
            posFoundIndex = i + 1;
            break;
          }
        }
        if (posFoundIndex === -1) {
          return ContentService.createTextOutput(JSON.stringify({ "result": "error", "message": "해당 장소를 찾을 수 없습니다." })).setMimeType(ContentService.MimeType.JSON);
        }
      }

      // 1. [삭제]
      if (action === "delete_location") {
        posSheet.deleteRow(posFoundIndex);
        return ContentService.createTextOutput(JSON.stringify({ "result": "success", "message": "장소가 삭제되었습니다." })).setMimeType(ContentService.MimeType.JSON);
      } 
      
      // 2. [수정]
      else if (action === "update_location") {
        // B열: 좌표(위치), C열: 비고 업데이트
        posSheet.getRange(posFoundIndex, 2).setValue("'" + params.location); // 좌표도 텍스트 강제
        posSheet.getRange(posFoundIndex, 3).setValue(params.note);
        return ContentService.createTextOutput(JSON.stringify({ "result": "success", "message": "장소 정보가 수정되었습니다." })).setMimeType(ContentService.MimeType.JSON);
      } 
      
      // 3. [추가]
      else {
        // 장소명이 이미 존재하는지 중복 체크 (선택 사항)
        for (var i = 1; i < posRows.length; i++) {
          if (String(posRows[i][0]).trim() === targetPlace) {
            return ContentService.createTextOutput(JSON.stringify({ "result": "error", "message": "이미 존재하는 장소명입니다." })).setMimeType(ContentService.MimeType.JSON);
          }
        }
        
        var newPosRow = [
          targetPlace,          // A열: 장소명
          "'" + params.location, // B열: 좌표 (텍스트 강제)
          params.note || ""     // C열: 비고
        ];
        posSheet.appendRow(newPosRow);
        return ContentService.createTextOutput(JSON.stringify({ "result": "success", "message": "새 장소가 추가되었습니다." })).setMimeType(ContentService.MimeType.JSON);
      }
    }

    // ==========================================
    // [기능 1 & 2] 기존 출석 관리 로직 (✅ 텍스트 강제 변환 적용)
    // ==========================================
    var sheetName = params.sheetName || "조교_출석_현황"; 
    var sheet = doc.getSheetByName(sheetName);
    if (!sheet) {
      return ContentService.createTextOutput(JSON.stringify({ "result": "error", "error": "Sheet not found" })).setMimeType(ContentService.MimeType.JSON);
    }

    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var colMap = {};
    headers.forEach(function(header, i) { colMap[header] = i + 1; });

    if (action === "checkout_update") {
      var targetEmail = params["출근자 Email"];
      var targetClassId = params["수업ID"];
      
      var lastRow = sheet.getLastRow();
      if (lastRow < 2) return ContentService.createTextOutput(JSON.stringify({ "result": "error", "error": "No data" })).setMimeType(ContentService.MimeType.JSON);
      
      var foundRowIndex = -1;
      var data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

      for (var i = data.length - 1; i >= 0; i--) {
        var rowEmail = String(data[i][colMap["출근자 Email"] - 1]);
        var rowStatus = String(data[i][colMap["상태"] - 1]);
        var rowClassId = String(data[i][colMap["수업ID"] - 1]);

        if (rowEmail === targetEmail && rowClassId === targetClassId && rowStatus === "출근") {
          foundRowIndex = i + 2; 
          break;
        }
      }

      if (foundRowIndex !== -1) {
        // ✅ [수정] 퇴근/근무 시간 업데이트 시 ' 붙이기
        if (colMap["퇴근 시간"]) sheet.getRange(foundRowIndex, colMap["퇴근 시간"]).setValue("'" + params["퇴근 시간"]);
        if (colMap["근무 시간"]) sheet.getRange(foundRowIndex, colMap["근무 시간"]).setValue("'" + params["근무 시간"]);
        if (colMap["상태"]) sheet.getRange(foundRowIndex, colMap["상태"]).setValue("퇴근");
        return ContentService.createTextOutput(JSON.stringify({ "result": "success" })).setMimeType(ContentService.MimeType.JSON);
      } else {
        return ContentService.createTextOutput(JSON.stringify({ "result": "error", "error": "출근 기록 없음" })).setMimeType(ContentService.MimeType.JSON);
      }
    } else {
      // ✅ [수정] 새 행 추가 시 날짜/시간 열은 텍스트로 강제
      var newRow = [];
      headers.forEach(function(header) { 
        var val = params[header] || "";
        // 헤더 이름에 '일자', '시간', 'Date', 'Time' 등이 포함되면 ' 붙이기
        if (header.includes("일자") || header.includes("시간") || header.includes("Date") || header.includes("Time")) {
          val = "'" + val;
        }
        newRow.push(val); 
      });
      sheet.appendRow(newRow);
      return ContentService.createTextOutput(JSON.stringify({ "result": "success", "row": sheet.getLastRow() })).setMimeType(ContentService.MimeType.JSON);
    }

  } catch (e) {
    return ContentService.createTextOutput(JSON.stringify({ "result": "error", "error": e.toString() })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}