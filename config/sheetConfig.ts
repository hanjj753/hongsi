// 이전 Google Sheets 연동 코드의 호환성을 위해 설정 구조만 유지합니다.
// 운영은 Supabase를 사용하며, 실제 시트/Apps Script 주소는 제거했습니다.

// 구글 시트 READ를 할 때에는 CSV를 이용.
export const CSV_URLS = {

    // 수업 생성 시트 - [웹/앱] / [수업 생성 시트] / [마스터 시트 생성용]
    CLASSES : "",

    // 조교 출석 시트 - [웹/앱] / [data] / [Data_Storage] / [조교_출석_현황]
    ATTENDANCE_LOG : "",

    // 수업 일정 시트 - [웹/앱] / [data] / [Data_Storage] / [전체_수업_일정]
    CLASS_SCHEDULES: "",

    // 수업 위치 시트 - [웹/앱] / [data] / [Data_Storage] / [수업_장소들]
    POSITIONS : "",

    // 조교 정보 시트 - [웹/앱] / [data] / [조교 관리 시트] / [조교 정보]
    ASSISTANT_INFO : "",

    // 앱 권한 관리 시트 - [웹/앱] / [data] / [조교 관리 시트] / [앱 권한 관리]
    PERMISSIONS : "",

    // 앱 권한 관리 시트 - [웹/앱] / [data] / [조교 관리 시트] / [문의 관리]
    INQUIRY : "",
  };

// 구글 시트 WRITE를 할 때에는 Google Apps Script 웹앱 URL을 이용.
export const API_URLS = {

    // 조교 출석 시트 - [웹/앱] / [data] / [Data_Storage] / [조교_출석 현황]
    ATTENDANCE_LOG : "",

    // 메시지 저장 시트 - [웹/앱] / [data] / [TEXT_Storage] / [메시지 log]
    MESSAGE_LOG : "",

    // 조교 정보 시트 및 앱 권한 관리 시트 - [웹/앱] / [data] / [조교 관리 시트] / [조교 정보] & [앱 권한 관리] & [문의 관리]
    ASSISTANT_MGMT : "",

};

export const SHEET_NAMES = {
    PERMISSIONS: "앱 권한 관리", 
    ATTENDANCE: "조교_출석_현황", 
    MESSAGE_LOG: "메시지 log",
    ASSISTANT_INFO: "조교 정보",
    SCHEDULE: "전체_수업_일정",
    INQUIRY: "문의 관리",
    POSITIONS : "수업_장소들",
};

// 아래는 각 시트에서 헤더를 변경 시에 수정해야 하는 부분입니다.
// 각 키는 시트의 열의 코드에서 사용할 변수명을 나타내며, 값은 해당 열의 헤더 이름입니다.

// 수업 생성 시트 - [웹/앱] / [수업 생성 시트] / [마스터 시트 생성용]
// 마스터 시트에만 학교와 과목이 분리되어 있고, 그 아래의 "수업" = "학교" + " " + "과목"으로 구성됩니다.
export const CLASSES_HEADERS = {
  CLASS_ID: "수업 ID",        
  QUARTER: "분기",      
  SCHOOL: "학교",  
  SUBJECT: "과목",      
  DAY: "요일", 
  PLACE: "장소",        
  CLASS_START: "시작",   
  CLASS_END: "종료",          
  STUDENT_COUNT: "학생 수", 
  WORKER_COUNT: "조교 수", 
  WORKERS: "근무자",     
  HOURLY_WAGE: "시급",
  SHEET_URL: "시트 CSV URL",
  MASTER_SHEET_URL: "마스터 시트 URL",
};

// 조교 출석 시트 - [웹/앱] / [data] / [Data_Storage] / [조교_출석 현황]
export const ATTENDANCE_LOG_HEADERS = {
  ATTENDANCE_DATE: "근무 일자",
  CLASS_ID: "수업ID",
  QUARTER: "분기",
  CLASS_NAME: "수업",
  DAY: "요일", 
  WORKERS: "출근자", 
  WORKER_EMAIL: "출근자 Email",
  ATTENDANCE_START: "출근 시간",
  ATTENDANCE_END: "퇴근 시간",
  WORK_DURATION: "근무 시간",
  STATUS: "상태",
  WORKER_LOCATION: "위치",
  NOTE: "비고",
};

// 수업 위치 시트 - [웹/앱] / [data] / [Data_Storage] / [수업_장소들]
export const POSITIONS_HEADERS = {
  PLACE: "장소",
  PLACE_LOCATION: "좌표",
  NOTE: "비고",
};

// 메시지 저장 시트 - [웹/앱] / [data] / [TEXT_Storage] / [메시지 log]
export const MESSAGE_LOG_HEADERS = {
  CLASS_ID: "수업 ID",    
  QUARTER: "분기",
  CLASS_NAME: "수업",
  DAY: "요일",
  ID: "ID",              // 수업 ID는 CLASS_ID, 학생 ID는 ID
  STUDENT_NAME: "학생",
  PARENT_PHONE: "학부모 전화번호",
  MESSAGE_STATUS: "상태",
  CONTENT: "내용",
};

// 마스터 시트 
// 5행의 A~G열까지의 헤더
export const MASTER_SHEET_HEADERS = {
  CLASS_NAME: "수업",
  DAY: "요일",
  ID: "ID",
  STUDENT_NAME: "학생",
  STUDENT_PHONE: "학생 전화번호",
  PARENT_PHONE: "학부모 전화번호",
  STUDENT_EMAIL: "이메일",
  STUDENT_ATTENDANCE: "출석",
  STUDENT_HOMEWORK: "숙제",
  STUDENT_TEST: "시험",
};
export const MASTER_SHEET_HEADER_ROW = 5;
export const MASTER_DATA_COL_SHIFT = 7; // H열부터 데이터 시작
export const MASTER_SESSION_STRIDE = 3; // 데이터가 3열 간격으로 배치

// 수업별 시트
// 5행의 A~E열까지의 헤더
export const CLASS_SHEET_HEADERS = {
  ID: "ID",
  STUDENT_NAME: "학생",
  STUDENT_PHONE: "학생 전화번호",
  PARENT_PHONE: "학부모 전화번호",
  STUDENT_EMAIL: "이메일",
  STUDENT_ATTENDANCE: "출석",
  STUDENT_HOMEWORK: "숙제",
  STUDENT_TEST: "시험",
};
export const CLASS_SHEET_HEADER_ROW = 5;
export const CLASS_DATA_COL_SHIFT = 5; // F열부터 데이터 시작
export const CLASS_SESSION_STRIDE = 3; // 데이터가 3열 간격으로 배치

// 조교 정보 시트 - [웹/앱] / [data] / [조교 관리 시트] / [조교 정보]
export const ASSISTANT_HEADERS = {
  POSITION: "직책",      
  NAME: "성명",          
  PHONE: "전화번호",      
  EMAIL: "gmail",       
  ROLE: "역할",          
  START_DATE: "근무 시작",
  ACCOUNT: "계좌번호",    
  STATUS: "비고",       
};

// 앱 권한 관리 시트 - [웹/앱] / [data] / [조교 관리 시트] / [앱 권한 관리]
export const PERMISSION_HEADERS = {
  NAME: "이름",
  EMAIL: "이메일",
  ROLE: "권한",
  DEVICE_ID: "Device ID",
  STATUS: "상태",
};

// 수업 일정 시트 - [웹/앱] / [data] / [Data_Storage] / [전체_수업_일정]
export const SCHEDULE_HEADERS = {
    CLASS_ID: "수업ID",
    QUARTER: "분기",
    CLASS_NAME: "수업",
    DAY: "요일",
    SESSION: "차시",
    DATE: "날짜",
    WORKERS: "예정 근무자",
    NOTE: "비고",
};

export const INQUIRY_HEADERS = {
  ID: "ID",
  DATE: "날짜",
  NAME: "이름",
  EMAIL: "이메일",
  CONTENT: "내용",
  STATUS: "상태",
};
