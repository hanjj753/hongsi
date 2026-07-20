/* 조교 근무 관리 시트 Google Apps Script*/

function jsonResponse_(body) {
  return ContentService.createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}

function normalizeEmail_(value) {
  return String(value || "").trim().toLowerCase();
}

function sheetValueText_(value, pattern) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), pattern);
  }
  return String(value || "").replace(/^'/, "").trim();
}

function findActiveAttendance_(sheet, email) {
  var targetEmail = normalizeEmail_(email);
  if (!targetEmail || sheet.getLastRow() < 2) return null;

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var colMap = {};
  headers.forEach(function(header, i) { colMap[String(header).trim()] = i; });

  var required = ["출근자 Email", "상태", "수업ID"];
  for (var r = 0; r < required.length; r++) {
    if (colMap[required[r]] === undefined) {
      throw new Error("필수 열이 없습니다: " + required[r]);
    }
  }

  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  for (var i = data.length - 1; i >= 0; i--) {
    var rowEmail = normalizeEmail_(data[i][colMap["출근자 Email"]]);
    var rowStatus = String(data[i][colMap["상태"]] || "").trim();
    if (rowEmail === targetEmail && rowStatus === "출근") {
      return {
        checkedIn: true,
        classId: String(data[i][colMap["수업ID"]] || "").trim(),
        className: colMap["수업"] === undefined ? "" : String(data[i][colMap["수업"]] || "").trim(),
        email: rowEmail,
        workDate: colMap["근무 일자"] === undefined ? "" : sheetValueText_(data[i][colMap["근무 일자"]], "yyyy-MM-dd"),
        startTime: colMap["출근 시간"] === undefined ? "" : sheetValueText_(data[i][colMap["출근 시간"]], "HH:mm"),
        row: i + 2
      };
    }
  }

  return null;
}

function doGet(e) {
  try {
    var params = (e && e.parameter) || {};
    if (params.action !== "attendance_status") {
      return jsonResponse_({ result: "error", error: "Unsupported action" });
    }

    var doc = SpreadsheetApp.getActiveSpreadsheet();
    var sheetName = params.sheetName || "조교_출석_현황";
    var sheet = doc.getSheetByName(sheetName);
    if (!sheet) return jsonResponse_({ result: "error", error: "Sheet not found" });

    var attendance = findActiveAttendance_(sheet, params.email);
    return jsonResponse_({
      result: "success",
      attendance: attendance || { checkedIn: false }
    });
  } catch (error) {
    return jsonResponse_({ result: "error", error: error.toString() });
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  var lockAcquired = lock.tryLock(10000);
  if (!lockAcquired) {
    return jsonResponse_({ result: "error", error: "요청이 몰려 처리하지 못했습니다. 잠시 후 다시 시도해주세요." });
  }

  try {
    var doc = SpreadsheetApp.getActiveSpreadsheet();
    var params = JSON.parse(e.postData.contents);
    var action = params.action || "checkin";

    // ==========================================
    // [기능 4] 수업 일정 관리 (추가 / 수정 / 삭제)
    // ==========================================
    if (action === "add_class_schedule" || action === "add_class_schedules" || action === "update_class_schedule" || action === "delete_class_schedule") {
      var scheduleSheet = doc.getSheetByName("전체_수업_일정");
      if (!scheduleSheet) {
        return ContentService.createTextOutput(JSON.stringify({ "result": "error", "error": "'전체_수업_일정' 시트를 찾을 수 없습니다." })).setMimeType(ContentService.MimeType.JSON);
      }

      var rows = scheduleSheet.getDataRange().getValues();
      var foundIndex = -1;

      if (action === "add_class_schedules") {
        var schedules = Array.isArray(params.schedules) ? params.schedules : [];
        if (schedules.length < 1 || schedules.length > 60) {
          return jsonResponse_({ result: "error", error: "일정은 한 번에 1~60개까지 등록할 수 있습니다." });
        }

        var existingScheduleKeys = {};
        for (var existingIndex = 1; existingIndex < rows.length; existingIndex++) {
          existingScheduleKeys[String(rows[existingIndex][0]).trim() + "::" + String(rows[existingIndex][4]).trim()] = true;
        }

        var batchKeys = {};
        var newScheduleRows = [];
        for (var scheduleIndex = 0; scheduleIndex < schedules.length; scheduleIndex++) {
          var schedule = schedules[scheduleIndex] || {};
          var classId = String(schedule.classId || "").trim();
          var session = String(schedule.session || "").trim();
          var date = String(schedule.date || "").trim();
          var key = classId + "::" + session;

          if (!classId || !session || !date) {
            return jsonResponse_({ result: "error", error: "수업ID, 차시, 날짜는 필수입니다." });
          }
          if (existingScheduleKeys[key] || batchKeys[key]) {
            return jsonResponse_({ result: "error", error: session + "차시가 이미 등록되어 있습니다." });
          }

          batchKeys[key] = true;
          newScheduleRows.push([
            classId,
            schedule.quarter || "",
            schedule.className || "",
            schedule.day || "",
            session,
            "'" + date,
            schedule.workers || "",
            schedule.note || ""
          ]);
        }

        scheduleSheet.getRange(scheduleSheet.getLastRow() + 1, 1, newScheduleRows.length, 8).setValues(newScheduleRows);
        SpreadsheetApp.flush();
        return jsonResponse_({ result: "success", count: newScheduleRows.length });
      }

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
        for (var duplicateIndex = 1; duplicateIndex < rows.length; duplicateIndex++) {
          if (String(rows[duplicateIndex][0]).trim() === String(params.classId || "").trim() &&
              String(rows[duplicateIndex][4]).trim() === String(params.session || "").trim()) {
            return jsonResponse_({ result: "error", error: String(params.session) + "차시가 이미 등록되어 있습니다." });
          }
        }

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
    // [기능 5] 근무 기록 직접 추가 / 삭제
    // ==========================================
    if (action === "add_attendance_log") {
      var addSheet = doc.getSheetByName("조교_출석_현황");
      if (!addSheet) return jsonResponse_({ result: "error", error: "시트를 찾을 수 없습니다." });

      var addRecord = params.record || {};
      var addEmail = normalizeEmail_(addRecord["출근자 Email"]);
      var addDate = String(addRecord["근무 일자"] || "").trim();
      var addClass = String(addRecord["수업"] || "").trim();
      var addStart = String(addRecord["출근 시간"] || "").trim();
      var addEnd = String(addRecord["퇴근 시간"] || "").trim();
      if (!addEmail || !addDate || !addClass || !addStart || !addEnd) {
        return jsonResponse_({ result: "error", error: "날짜, 수업, 이메일, 출퇴근 시간은 필수입니다." });
      }

      var addHeaders = addSheet.getRange(1, 1, 1, addSheet.getLastColumn()).getValues()[0];
      var addColMap = {};
      addHeaders.forEach(function(header, index) { addColMap[String(header).trim()] = index; });
      var addData = addSheet.getLastRow() < 2
        ? []
        : addSheet.getRange(2, 1, addSheet.getLastRow() - 1, addSheet.getLastColumn()).getValues();

      for (var addIndex = addData.length - 1; addIndex >= 0; addIndex--) {
        var existingDate = sheetValueText_(addData[addIndex][addColMap["근무 일자"]], "yyyy-MM-dd");
        var existingEmail = normalizeEmail_(addData[addIndex][addColMap["출근자 Email"]]);
        var existingClass = String(addData[addIndex][addColMap["수업"]] || "").trim();
        var existingStart = sheetValueText_(addData[addIndex][addColMap["출근 시간"]], "HH:mm");
        var existingEnd = sheetValueText_(addData[addIndex][addColMap["퇴근 시간"]], "HH:mm");
        if (existingDate === addDate && existingEmail === addEmail && existingClass === addClass && existingStart === addStart && existingEnd === addEnd) {
          return jsonResponse_({ result: "success", alreadyExists: true, row: addIndex + 2 });
        }
      }

      var attendanceRow = addHeaders.map(function(header) {
        var normalizedHeader = String(header).trim();
        var value = addRecord[normalizedHeader] || "";
        if (normalizedHeader.includes("일자") || normalizedHeader.includes("시간") || normalizedHeader.includes("Date") || normalizedHeader.includes("Time")) {
          value = "'" + value;
        }
        return value;
      });
      addSheet.appendRow(attendanceRow);
      SpreadsheetApp.flush();
      return jsonResponse_({ result: "success", row: addSheet.getLastRow() });
    }

    if (action === "delete_attendance_log") {
      var deleteSheet = doc.getSheetByName("조교_출석_현황");
      if (!deleteSheet) return jsonResponse_({ result: "error", error: "시트를 찾을 수 없습니다." });

      var deleteData = deleteSheet.getDataRange().getValues();
      var deleteHeaders = deleteData[0];
      var deleteColMap = {};
      deleteHeaders.forEach(function(header, index) { deleteColMap[String(header).trim()] = index; });
      var deleteRow = -1;

      for (var deleteIndex = deleteData.length - 1; deleteIndex >= 1; deleteIndex--) {
        var deleteDate = sheetValueText_(deleteData[deleteIndex][deleteColMap["근무 일자"]], "yyyy-MM-dd");
        var deleteEmail = normalizeEmail_(deleteData[deleteIndex][deleteColMap["출근자 Email"]]);
        var deleteClass = String(deleteData[deleteIndex][deleteColMap["수업"]] || "").trim();
        var deleteStart = sheetValueText_(deleteData[deleteIndex][deleteColMap["출근 시간"]], "HH:mm");
        var deleteEnd = sheetValueText_(deleteData[deleteIndex][deleteColMap["퇴근 시간"]], "HH:mm");
        if (deleteDate === String(params.targetDate || "").trim() &&
            deleteEmail === normalizeEmail_(params.targetEmail) &&
            deleteClass === String(params.targetClass || "").trim() &&
            deleteStart === String(params.oldStart || "").trim() &&
            deleteEnd === String(params.oldEnd || "").trim()) {
          deleteRow = deleteIndex + 1;
          break;
        }
      }

      if (deleteRow === -1) return jsonResponse_({ result: "error", error: "일치하는 기록을 찾을 수 없습니다." });
      deleteSheet.deleteRow(deleteRow);
      SpreadsheetApp.flush();
      return jsonResponse_({ result: "success", deletedRow: deleteRow });
    }

    // ==========================================
    // [기능 5-1] 근무 기록 수정 (✅ 텍스트 강제 변환 적용)
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
    headers.forEach(function(header, i) { colMap[String(header).trim()] = i + 1; });

    if (action === "checkout_update") {
      var targetEmail = normalizeEmail_(params["출근자 Email"]);
      var targetClassId = String(params["수업ID"] || "").trim();

      if (!targetEmail || !targetClassId) {
        return jsonResponse_({ result: "error", error: "이메일과 수업ID가 필요합니다." });
      }
      if (!colMap["출근자 Email"] || !colMap["상태"] || !colMap["수업ID"]) {
        return jsonResponse_({ result: "error", error: "출퇴근 처리에 필요한 열이 없습니다." });
      }
      
      var lastRow = sheet.getLastRow();
      if (lastRow < 2) return jsonResponse_({ result: "error", error: "No data" });
      
      var foundRowIndexes = [];
      var alreadyCheckedOut = false;
      var data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

      for (var i = data.length - 1; i >= 0; i--) {
        var rowEmail = normalizeEmail_(data[i][colMap["출근자 Email"] - 1]);
        var rowStatus = String(data[i][colMap["상태"] - 1] || "").trim();
        var rowClassId = String(data[i][colMap["수업ID"] - 1] || "").trim();

        if (rowEmail === targetEmail && rowClassId === targetClassId) {
          if (rowStatus === "출근") foundRowIndexes.push(i + 2);
          if (rowStatus === "퇴근") alreadyCheckedOut = true;
        }
      }

      if (foundRowIndexes.length > 0) {
        foundRowIndexes.forEach(function(rowIndex) {
          if (colMap["퇴근 시간"]) sheet.getRange(rowIndex, colMap["퇴근 시간"]).setValue("'" + params["퇴근 시간"]);
          if (colMap["근무 시간"]) sheet.getRange(rowIndex, colMap["근무 시간"]).setValue("'" + params["근무 시간"]);
          sheet.getRange(rowIndex, colMap["상태"]).setValue("퇴근");
        });
        SpreadsheetApp.flush();
        return jsonResponse_({
          result: "success",
          attendance: { checkedIn: false },
          updatedRows: foundRowIndexes.length
        });
      }

      if (alreadyCheckedOut) {
        return jsonResponse_({
          result: "success",
          attendance: { checkedIn: false },
          alreadyCheckedOut: true
        });
      }

      return jsonResponse_({ result: "error", error: "출근 기록 없음" });
    } else if (action === "checkin") {
      var checkInEmail = normalizeEmail_(params["출근자 Email"]);
      var checkInClassId = String(params["수업ID"] || "").trim();
      if (!checkInEmail || !checkInClassId) {
        return jsonResponse_({ result: "error", error: "이메일과 수업ID가 필요합니다." });
      }

      var activeAttendance = findActiveAttendance_(sheet, checkInEmail);
      if (activeAttendance) {
        if (activeAttendance.classId === checkInClassId) {
          return jsonResponse_({
            result: "success",
            attendance: activeAttendance,
            alreadyActive: true
          });
        }
        return jsonResponse_({
          result: "error",
          code: "ALREADY_CHECKED_IN",
          error: "이미 다른 수업에 출근 중입니다.",
          attendance: activeAttendance
        });
      }

      // ✅ [수정] 새 행 추가 시 날짜/시간 열은 텍스트로 강제
      var newRow = [];
      headers.forEach(function(header) { 
        var normalizedHeader = String(header).trim();
        var val = params[normalizedHeader] || "";
        // 헤더 이름에 '일자', '시간', 'Date', 'Time' 등이 포함되면 ' 붙이기
        if (normalizedHeader.includes("일자") || normalizedHeader.includes("시간") || normalizedHeader.includes("Date") || normalizedHeader.includes("Time")) {
          val = "'" + val;
        }
        newRow.push(val); 
      });
      sheet.appendRow(newRow);
      SpreadsheetApp.flush();
      var createdAttendance = findActiveAttendance_(sheet, checkInEmail);
      return jsonResponse_({
        result: "success",
        row: sheet.getLastRow(),
        attendance: createdAttendance || { checkedIn: true, classId: checkInClassId, email: checkInEmail }
      });
    }

    return jsonResponse_({ result: "error", error: "Unsupported action: " + action });

  } catch (e) {
    return ContentService.createTextOutput(JSON.stringify({ "result": "error", "error": e.toString() })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}
