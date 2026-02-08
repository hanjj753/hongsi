// utils/notificationScheduler.ts
import * as Notifications from 'expo-notifications';
import { fetchSheetData } from './googleSheet_csv';
import { CSV_URLS, SCHEDULE_HEADERS, CLASSES_HEADERS, ASSISTANT_HEADERS } from '../config/sheetConfig';

// 알림 핸들러 설정 (앱이 켜져있을 때도 알림 표시)
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// 시간 파싱 헬퍼 (HH:MM -> [HH, MM])
const parseTime = (timeStr: string) => {
  if (!timeStr) return [0, 0];
  const parts = timeStr.includes(':') ? timeStr.split(':') : [timeStr, "0"];
  return parts.map(Number);
};

export async function scheduleCheckInNotifications(myEmail: string, reminderOffsets: number[]) {
  // 1. 기존 알림 모두 취소 (중복 방지)
  await Notifications.cancelAllScheduledNotificationsAsync();

  if (reminderOffsets.length === 0) return; // 설정된 시간이 없으면 종료

  try {
    // 2. 권한 요청
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') {
      console.log('알림 권한이 거부되었습니다.');
      return;
    }

    // 3. 데이터 가져오기 (조교정보, 수업정보, 일정)
    const [aData, cData, sData] = await Promise.all([
      fetchSheetData(CSV_URLS.ASSISTANT_INFO),
      fetchSheetData(CSV_URLS.CLASSES),
      fetchSheetData(CSV_URLS.CLASS_SCHEDULES)
    ]);

    if (!Array.isArray(aData) || !Array.isArray(cData) || !Array.isArray(sData)) return;

    // 4. 내 이름(실명) 찾기
    const myRecord = aData.find((r: any) => 
      String(r[ASSISTANT_HEADERS.EMAIL] || "").trim().toLowerCase() === myEmail.trim().toLowerCase()
    );
    if (!myRecord) return;
    const myName = String(myRecord[ASSISTANT_HEADERS.NAME] || "").trim();
    if (!myName) return;

    // 5. 수업 시간 정보 매핑 (ClassID -> {start, name})
    const classMap = new Map<string, { start: string, name: string }>();
    cData.forEach((row: any) => {
      const cid = String(row[CLASSES_HEADERS.CLASS_ID] ?? "").trim();
      
      // ✅ [수정] 학교 + 과목으로 이름 조합
      const school = String(row[CLASSES_HEADERS.SCHOOL] ?? "").trim();
      const subject = String(row[CLASSES_HEADERS.SUBJECT] ?? "").trim();
      const cname = (school && subject) ? `${school} ${subject}` : (school || subject || "수업");

      const start = String(row[CLASSES_HEADERS.CLASS_START] ?? "").trim();
      
      if (cid) classMap.set(cid, { start, name: cname });
    });

    // 6. 미래 일정 필터링 및 알림 예약
    const now = new Date();
    let count = 0;

    for (const row of sData) {
      const dateStr = String(row[SCHEDULE_HEADERS.DATE] ?? "").trim(); // YYYY-MM-DD
      if (!dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) continue;

      const cid = String(row[SCHEDULE_HEADERS.CLASS_ID] ?? "").trim();
      const workers = String(row[SCHEDULE_HEADERS.WORKERS] ?? "").trim();
      
      // 근무자에 내 이름이 포함되어 있는지 확인 (콤마 구분)
      const workerList = workers.split(',').map(w => w.trim());
      if (!workerList.includes(myName)) continue;

      // 수업 정보(시작 시간) 확인
      const classInfo = classMap.get(cid);
      if (!classInfo || !classInfo.start) continue;

      // 수업 시작 일시(Date) 생성
      const [y, m, d] = dateStr.split('-').map(Number);
      const [sh, sm] = parseTime(classInfo.start);
      
      const classStartTime = new Date(y, m - 1, d, sh, sm);
      
      // 이미 지난 수업은 패스
      if (classStartTime <= now) continue;

      // 선택한 알림 시간(분)마다 예약
      for (const offset of reminderOffsets) {
        const triggerDate = new Date(classStartTime.getTime() - offset * 60 * 1000);

        // 알림 시간이 현재보다 미래인 경우에만 예약
        if (triggerDate > now) {
          const offsetText = offset === 0 ? "정시" : `${offset}분 전`;
          
          await Notifications.scheduleNotificationAsync({
            content: {
              title: `📅 출근 알림 (${offsetText})`,
              body: `${classInfo.name} 수업이 곧 시작됩니다! 출근 버튼을 눌러주세요.`,
              sound: true,
              data: { classId: cid },
            },
            // ✅ [수정] 타입 오류 해결: { date: Date객체 } 형태로 전달
            trigger: { date: triggerDate } as unknown as Notifications.CalendarNotificationTrigger,
          });
          count++;
        }
      }
    }

    console.log(`[알림 예약] 총 ${count}개의 알림이 예약되었습니다. (대상: ${myName})`);
    return count;

  } catch (e) {
    console.error("알림 스케줄링 에러", e);
  }
}