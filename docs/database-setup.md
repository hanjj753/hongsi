# 개발 DB 적용 및 Firebase 연결 상태

> 운영 현황: `hongsi-eta.vercel.app`은 `hongsi-dev` Supabase 프로젝트를 실제 데이터베이스로 사용한다. 화면의 개발 모드 문구는 제거했다. 이 프로젝트에 입력하는 내용은 운영 데이터다.

작성: 2026-09-13 · 갱신: 2026-10-24 · 브랜치 `main`

## 적용 완료

- Supabase 프로젝트: [hongsi-dev](https://supabase.com/dashboard/project/xhyzngxwxeooffmcaxyl), 서울 리전.
- SQL Editor에서 기존 public 업무 테이블 0개를 확인한 후 순서대로 적용:
  1. `supabase/migrations/20260913000100_initial_schema.sql`
  2. `supabase/migrations/20260913000200_firebase_access.sql`
  3. `supabase/migrations/20260923000300_remove_class_code.sql`
  4. `supabase/migrations/20260924000400_student_records_rpc.sql`
  5. `supabase/migrations/20260924000500_preserve_existing_student_details.sql`
  6. `supabase/migrations/20260925000600_bulk_records_and_student_validation.sql`
  7. `supabase/migrations/20260925000700_class_catalog_and_session_items.sql`
  8. `supabase/migrations/20260926000800_enrollment_moves_makeups_and_session_staff.sql`
  9. `supabase/migrations/20260926000900_restrict_enrollment_reactivation.sql`
  10. `supabase/migrations/20260926001000_link_makeup_sessions.sql`
  11. `supabase/migrations/20260926001100_class_enrollment_session_management.sql`
  12. `supabase/migrations/20261001001200_class_day_part.sql`
  13. `supabase/migrations/20261001001300_test_result_formats.sql`
  14. `supabase/migrations/20261001001400_staff_and_workflows.sql`
  15. `supabase/migrations/20261001001500_work_label_weekdays.sql`
  16. `supabase/migrations/20261002001600_staff_bank_and_class_work_summary.sql`
  17. `supabase/migrations/20261008001700_bank_save_and_minute_work_duration.sql`
  18. `supabase/migrations/20261008001800_message_workflows.sql`
  19. `supabase/migrations/20261008001900_session_assigned_message_claims.sql`
  20. `supabase/migrations/20261008002000_delete_unused_location.sql`
  21. `supabase/migrations/20261009002100_clinic_weekday_schedule.sql`
- 초기 적용 시 조회 결과: **테이블 20 / RLS 활성 20 / 정책 54 / 직원 0 / 학생 0**. 2026-09-20 첫 관리자 직원 1명을 추가했다.
- 실제 개발 REST API 검증: 공개 키만 사용한 학생·계좌정보·`get_my_access` 요청 모두 HTTP 401.
- 매니저/관리자 모두 기기 등록·허용·차단 가능. 계정 승인은 관리자만 가능하고, 계좌 조회는 매니저 이상, 수정은 관리자만 가능.
- 2026-09-19 Supabase Third-Party Auth 화면에서 Firebase 프로젝트 `hongsi-assistant` 연결의 **ENABLED** 상태를 확인했다. 이미 등록되어 있어 중복 생성하지 않았다.
- `.env.local`에 개발 프로젝트 URL과 Publishable key를 설정했다. 비밀 키는 사용하지 않았으며 이 파일은 Git에서 제외된다. 다른 환경에서는 `.env.example`을 복사하고 공개 키를 채운다.

적용된 SQL은 수정하지 않는다. SQL Editor 실행은 CLI의 migration history에 자동 등록되지 않으므로, CLI `db push`를 쓰기 전에 적용된 모든 버전(현재 26번까지)의 상태를 확인하고 `migration repair --status applied`로 이력을 동기화해야 한다. 같은 SQL을 다시 실행하지 않는다.

## 2026-10-24 메시지 개별 취소

`supabase/migrations/20261024002600_cancel_pending_message.sql`을 운영 사이트가 사용하는 `hongsi-dev` 프로젝트의 SQL Editor에서 실행하고 성공 결과를 확인했다. 이 RPC는 한 메시지에서 아직 `pending`인 수신자만 `cancelled`로 바꾸며, 다른 메시지와 이미 전송 중이거나 제출된 기록은 유지한다. 기존 메시지 데이터는 적용 시 변경하지 않는다. 권한 및 일부 수신자만 취소되는 경우는 로컬 PGlite 테스트에서 검증했다.

## 2026-10-11 DB 사용량 표시 및 수업별 근무 기록 추가

`supabase/migrations/20261011002200_database_usage.sql`은 관리 권한 계정만 현재 PostgreSQL DB 크기를 읽도록 하는 RPC를 추가한다. 분기/수업 관리 화면은 무료 플랜의 500 MB 기준으로 사용량과 비율을 표시한다. 앱 화면에 적용하기 전 개발 DB에서 이 SQL을 실행해야 한다. SQL은 로컬 PGlite 접근 권한 테스트를 통과했으며, 개발 DB 적용 여부는 별도로 확인한다.

수업 화면의 출근 관리에서는 관리자만 근무자를 선택해 기록을 추가할 수 있다. 퇴근 시간을 비우면 `ended_at = NULL`인 근무 중 기록이 되고, DB의 직원별 동시 출근 1건 제한을 따른다. 기존 조교 탭에서 퇴근 시간을 나중에 입력할 수 있다.

## 2026-10-09 클리닉·요일별 시간 적용

`supabase/migrations/20261009002100_clinic_weekday_schedule.sql`은 로컬 PGlite에서 검증했고 개발 DB에서 새 테이블·RPC의 존재 및 익명 차단을 읽기 전용 API로 확인했다. 수업 종류(`regular/clinic`), 요일별 시간표, 분기당 클리닉 1개 제약, 클리닉 차시 참여, 날짜순 차시 번호 재정렬을 추가한다. 기존 수업의 선택된 요일에는 현재 기본 시간과 시간대를 복사하고, 기존 차시 번호도 날짜순으로 다시 매긴다. 차시의 출석·숙제·시험은 차시 ID로 연결되어 있으므로 번호 변경 시 기록 자체는 이동하지 않는다.

적용 후 수업 추가 화면에서 클리닉을 선택하면 학교·과목 입력 없이 저장할 수 있다. 기존 수업은 수업 종류를 변경할 수 없고, 클리닉 학생은 차시의 **클리닉 참여 학생** 버튼으로 같은 분기의 정식 수강생 중에서 선택한다. 정식 수강 상태는 그대로이며 기록은 클리닉 차시와 전체 학생 기록에 보인다.

## Firebase 연결 및 첫 관리자 등록 완료

2026-09-20 사용자가 제공한 저장소 밖의 서비스 계정 키로 다음을 확인·적용했다. 키 내용과 인증 토큰은 출력하거나 저장소에 복사하지 않았다.

1. Firebase Admin SDK로 `hongsi20222@gmail.com`의 실제 UID, 이메일 인증 완료, 비활성화되지 않은 계정임을 확인했다.
2. 기존 custom claims를 보존하면서 `role: authenticated`를 추가하고 저장 결과를 다시 조회했다. 이는 Supabase 로그인용이며 업무상 관리자 권한과는 별개다.
3. `hongsi-dev`에 직원 **id 1 / 이름 홍시 / active**, 접근 권한 **admin / approved**를 생성했다. 검증한 Firebase UID에 연결했으며, 기존 관리자가 있거나 UID·이메일이 충돌하면 전체 작업을 중단하는 트랜잭션으로 실행했다. 재실행하지 않는다.
4. Firebase Admin SDK의 custom-token 로그인으로 실제 Firebase ID 토큰을 발급받아 서명·UID·이메일·claim을 확인하고, 개발 Supabase API에서 `get_my_access`를 호출했다. **admin / approved / 계정 관리 가능 / 기기 관리 가능**을 반환했고, 응답의 직원 ID가 같은 Firebase 사용자에 연결된 것도 검증했다.
5. 익명 학생·계좌정보·권한 조회 요청은 여전히 HTTP 401로 차단됐다.

실제 토큰 → Supabase API 연결과 웹 Google 팝업 로그인, 웹 앱의 권한 확인·홈·수업·차시 조회 흐름은 검증됐다. Android 로그인 UI는 아직 별도 검증 전이다. 이후 계정 승인/중지/역할 변경은 관리자 전용 `admin_set_access`를 사용한다. 조교·매니저는 자기 계정의 상태 조회만 가능하다.

### Firebase custom claim 로컬 도구

`supabase/tools/provision-firebase.mjs`는 한 명의 기존 Firebase 사용자를 이메일로 조회한다. 기본 실행은 읽기 전용이며 `--apply`가 있을 때만 로그인 claim을 설정한다. 기존의 다른 custom claims는 보존하고, 이미 다른 `role` 값이 있으면 검토를 위해 중단한다. 이 도구는 앱 번들에 포함되지 않는다.

Firebase 관리용 서비스 계정 JSON이 로컬에 준비되어 있어야 한다. 이번 설정에서는 사용자가 제공한 `D:\Workspace`의 키를 사용했으며, `D:\Workspace\hongsi` 저장소 밖에 그대로 보관한다. `.gitignore`에 `*-firebase-adminsdk-*.json`도 추가해 같은 형식의 파일이 실수로 들어오는 경우를 막았다. 이 규칙은 이미 Git이 추적하는 파일이나 과거 커밋에서는 키를 제거하지 않는다.

기존 `client_secret_…apps.googleusercontent.com.json`은 `web` 형식의 OAuth 클라이언트 설정으로, 서비스 계정 키가 아니므로 이 도구에 사용할 수 없다. 이 기존 파일은 Git 추적 대상이며 이번 작업에서 수정하지 않았다.

운영 자동 연결에는 Vercel의 비공개 서버 환경변수만 사용한다. 로컬 서비스 계정 파일은 수동 복구 도구에만 필요하며 Git 추적 대상이 아니다.

사용자가 콘솔에서 직접 진행할 순서:

1. Firebase 콘솔에서 `hongsi-assistant` → Authentication → Users에 지정 이메일이 있는지 확인한다. 없다면 기존 홍시 사이트에 해당 Google 계정으로 한 번 로그인한다.
2. 프로젝트 설정 → 서비스 계정 → Firebase Admin SDK에서 기존에 안전하게 보관한 서비스 계정 JSON이 있는지 확인한다. 없으면 새 비공개 키를 생성하고 내려받는다.
3. JSON은 소스 저장소 밖에 보관하고, 후속 로컬 실행에는 파일의 절대 경로만 전달한다. 내용이나 파일 자체를 채팅에 올리지 않는다.

콘솔 경로와 자격 증명 사용 방법: [Firebase Admin SDK 공식 설정 안내](https://firebase.google.com/docs/admin/setup#initialize_the_sdk_in_non-google_environments).

```powershell
cd D:\Workspace\hongsi\supabase\tools
npm ci
$env:GOOGLE_APPLICATION_CREDENTIALS = '실제 서비스 계정 JSON의 로컬 절대 경로'
node provision-firebase.mjs --email 'hongsi20222@gmail.com'
# 조회된 프로젝트/UID/이메일을 확인한 뒤:
node provision-firebase.mjs --email 'hongsi20222@gmail.com' --apply
```

수동 도구를 적용하면 검증된 UID·이메일·표시 이름·프로젝트 ID만 `supabase/.local/firebase-user.json`에 보관한다. 이 도구를 실행해도 DB의 관리자 권한이나 승인 상태가 자동 생성되지는 않는다. 첫 관리자 DB 등록은 별도 SQL로 완료했다. 신규 조교의 로그인 claim은 운영 서버가 자동 설정하며, 검증된 Firebase 이메일과 사전 등록 이메일이 같을 때만 DB 계정이 연결된다.

`supabase/tools/verify-firebase-access.mjs`는 기존의 인증된 관리자만 대상으로 custom-token 로그인을 수행하고 개발 DB를 읽는다. DB 쓰기나 역할 변경은 하지 않으며 ID 토큰과 refresh token은 프로세스 메모리에서만 사용한다. 로그인으로 Firebase의 마지막 로그인 시각은 갱신될 수 있다. Google 로그인 UI 검증을 대신하지 않는다.

```powershell
cd D:\Workspace\hongsi
# 위에서 설정한 GOOGLE_APPLICATION_CREDENTIALS 사용
node --env-file=.env.local supabase/tools/verify-firebase-access.mjs --email 'hongsi20222@gmail.com'
```

## 앱 연결 코드

- `lib/supabase.ts`: 공식 Supabase 클라이언트. Firebase ID 토큰을 요청별로 전달하고, Supabase 자체 로그인 세션을 중복 관리하지 않는다. 로그인 claim이 없으면 운영 서버에 검증된 토큰으로 자동 설정을 요청한 뒤 새 토큰을 받는다. 토큰 확인·갱신에는 각각 10초, DB 네트워크 요청에는 15초 제한이 있고 쓰기를 자동 재시도하지 않는다.
- `utils/appAccess.ts`: 본인 접근 상태 조회와 관리자 전용 계정 승인 RPC 호출. Firebase UID/승인 여부는 DB가 결정한다.
- `contexts/AppAccessContext.tsx`와 `components/AppAccessGate.tsx`: 개발 DB 모드에서 로그인 직후 승인 상태와 역할을 확인한다. 미등록·승인 대기·중지·비활성 계정은 업무 화면 대신 상태 안내를 본다.
- `lib/classData.ts`: 수업 목록, 위치, 수업 상세·차시·수강생·차시 기록을 개발 DB에서 조회한다. 장소와 학생 정보, 숙제·시험 항목도 DB에 저장한다.
- 운영 사이트는 `EXPO_PUBLIC_DATA_SOURCE=supabase`를 사용한다. 로컬에서도 기본 데이터 소스는 Supabase다. 이전 Sheets 화면 코드는 남아 있지만 현재 사용하지 않으며, 실제 연결 주소는 공개 소스에서 제거했다.
- Supabase 웹 로그인은 Google Drive 범위를 요청하거나 Sheets용 Google 액세스 토큰을 기다리지 않는다. 승인된 계정으로 진입한 홈 화면은 기존 조교·권한·출퇴근 시트를 읽지 않고 DB의 근무 현황을 표시한다.
- 수업 상세에서 수강 학생을 등록·수정한다. 학생 ID를 비우면 `S`와 임의 영문·숫자로 자동 생성하며, 한국 휴대전화 번호와 이메일 형식을 앱과 DB 양쪽에서 검사한다.
- 학생 ID는 분기와 무관하게 계속 유지된다. 수강 관계는 `수강 중/전반/퇴원`으로 관리하고, 같은 분기 전반 시 이전 반의 종료일과 새 반의 시작일을 한 트랜잭션으로 저장한다. 이전 차시 기록은 원래 반에 남는다.
- 다른 반에 한두 번 보강 오는 학생은 정식 수강생으로 중복 등록하지 않는다. B 차시의 **다른 반 보강 학생**에서 원래 A 차시를 선택하면, A에는 다른 반 보강 상태가 자동 생성되고 B에서 출석·숙제·시험을 입력할 수 있다. A/B의 날짜 순서는 제한하지 않으며 **전체 학생 기록**에서 양쪽 연결을 확인한다.
- 차시 화면은 수강생 전체를 가로 표로 보여 준다. 저장된 출석·보강·복수 숙제·복수 시험 결과가 다시 표시되고, 여러 학생을 고친 뒤 표 전체를 한 번에 저장한다. 전체 저장 RPC가 한 트랜잭션으로 처리하므로 한 행이라도 잘못되면 어느 행도 바뀌지 않는다. 빈 결과를 저장하면 숙제·시험을 다시 `미입력`으로 되돌릴 수 있다.
- 수업 탭의 분기/수업 관리에서 분기와 수업을 추가·수정·보관 삭제한다. 수업 상세에서는 단일 또는 반복 차시 일정을 추가하고, 새 일정마다 예정 근무자를 선택할 수 있다. 반복 일정은 요일과 주 수 또는 종료일을 정하며 최대 60개다. 삭제한 분기·수업은 연결된 기록을 보존하기 위해 비활성화하며, 숙제·시험 항목 삭제는 확인 뒤 학생 결과까지 한 트랜잭션으로 실제 삭제한다.
- 차시 기록은 학생 이름 가나다순이며, 숙제 등급별 인원과 시험의 만점·평균·최고·최저·결시 통계를 입력 중에도 계산한다.
- 개발 DB 모드의 조교 탭에서 조교 정보와 근무 기록을 조회한다. 직책은 CEO·실장·조교 순서로 표시하고 조교는 이름 가나다순으로 정렬한다. 매니저/관리자는 조교 정보와 근무 기록을 관리하고, 계좌는 매니저 이상이 조회하며 관리자만 수정한다. 앱 권한 관리는 관리자만 가능하다. 수업 상세의 출근/퇴근은 로그인 계정의 근무 기록에 서버 시각으로 저장하고, 출근 후 시작 시각과 해당 수업의 직원별 근무일·출퇴근 시각·근무 시간을 표로 표시한다. 운영 Sheets 모드는 기존 화면을 유지한다.
- 사용자가 데이터를 직접 입력하기로 했으므로 별도 데이터 이전 도구는 만들지 않는다. 입력 순서는 `docs/manual-data-entry.md`에 정리했다.
- 달력과 문의도 개발 DB에서 조회·작성한다. 수업의 메시지 패널은 공지와 차시별 개별 메시지, 학생별 기본 수신자에 맞춘 학부모/학생별 발송 대기와 이력을 제공한다. Android 발송 기기는 별도 비밀값으로 등록하고 매니저가 허용해야 전송할 수 있다. 메시지 기능 SQL `20261008001800_message_workflows.sql`은 개발 DB에 적용됐다. Android 앱을 다시 빌드하고 기기를 등록한 뒤 매니저가 허용해야 실제 발송할 수 있다.


## 2026-10-16 개발용 DB 적용: 사용량·시험 오답표

`hongsi-dev` SQL Editor에서 `20261011002200_database_usage.sql`과 `20261016002300_test_question_sheets.sql`을 순서대로 실행했다. 두 쿼리 모두 `Success. No rows returned`였다. 사용량 함수는 현재 DB의 `pg_database_size(current_database())`를 반환한다. 오답표용 두 테이블은 RLS ON이고 익명 조회가 불가하다. 저장 RPC는 `authenticated`에만 실행 권한이 있다. 조회 쿼리는 [개발 DB SQL Editor](https://supabase.com/dashboard/project/xhyzngxwxeooffmcaxyl/sql/c590fd4a-414d-42d5-a70a-522c9781cce5)에 남아 있다.

2026-10-24 `20261024002400_assistant_student_editor.sql`의 학생 등록·정보 수정 권한 변경을 같은 개발 DB에 적용했다. 승인된 조교도 학생을 등록하고 수정할 수 있지만 전반·퇴원·완전 삭제와 계정/계좌 권한은 변경하지 않았다. 기존 함수 본문과 데이터 행은 유지하고 세 함수의 권한 조건만 변경했으며 SQL Editor에서 적용 성공과 새 조건을 확인했다. 이 SQL은 다시 실행해도 이미 변경된 함수를 건너뛴다.

앱의 차시 화면 맨 아래에서 시험을 선택해 객관식·서술형 문항 수와 학생별 오답을 기록한다. PDF 저장/인쇄는 웹의 인쇄 창에서 PDF 저장을 선택하거나 Android/iOS의 PDF 공유 창을 사용한다. 이 개발 DB SQL 실행만으로 운영 사이트의 데이터 소스가 바뀌지는 않는다. Vercel Production 환경변수는 배포 전에 대시보드에서 확인해야 한다.

## main 배포 전 데이터 확인

- 코드 배포 자체는 Supabase SQL을 실행하거나 Google Sheets 데이터를 옮기지 않는다. Vercel Production의 `EXPO_PUBLIC_DATA_SOURCE`가 없거나 `sheets`이면 기존 Sheets를 계속 사용한다. `supabase`이면 `EXPO_PUBLIC_SUPABASE_URL`이 가리키는 프로젝트의 데이터만 표시한다.
- 새 DB로 전환하기 전에는 Sheets 데이터를 별도로 백업하고 필요한 학생·수업·차시·기록·조교·메시지를 DB에 입력·검증한다. 미입력 Sheets 기록은 지워지는 것이 아니라 새 화면에서 보이지 않게 된다.
- SQL Editor에서 적용한 migration history를 동기화하기 전에는 `supabase db push`를 실행하지 않는다. 중복 실행은 오류나 데이터 변경을 일으킬 수 있다.
- `20261009002100` 적용 시 기존 차시 번호를 날짜순으로 재정렬한다. 차시 ID와 연결된 성적·출석은 유지되지만 사용자에게 보이는 번호가 달라질 수 있다.
- 기존 기록을 넣은 테스트 DB에서 21~23번 SQL을 적용한 후 학생·수강·출석·숙제·시험·근무·메시지 행 수와 핵심 값을 비교했다. 실제 운영 DB를 복제한 검증은 아니므로 운영 DB에 적용하기 전 별도 백업이 필요하다.
- 앱의 `완전 삭제`와 항목·차시 삭제는 관련 기록도 삭제한다. 운영 데이터로 실행하기 전 해당 화면의 확인 문구와 백업을 확인한다.
- 같은 학생의 같은 차시를 여러 사용자가 동시에 수정하거나 같은 시험 오답표를 동시에 저장하면 마지막 저장이 이전 입력을 덮을 수 있다. 차시 전체 저장은 이번에 수정한 학생만 전송하지만, 동일 학생의 다른 입력 항목이나 오답표 전체에 대한 충돌 감지는 아직 없다.

로컬 `supabase/tests`의 스키마 30개, 권한 38개, 데이터 보존 테스트와 TypeScript 검사, Expo 웹 정적 빌드가 통과했다. 실제 개발 API 익명 접근 검사는 이 환경의 네트워크 제한으로 실행하지 못했지만, SQL Editor에서 두 테이블의 RLS와 `anon` 권한을 직접 확인했다.

## 새 조교 계정 연결

1. 조교 탭에서 이름과 로그인에 사용할 이메일을 등록한다. 이 단계는 앱 권한을 승인하지 않는다.
2. 해당 조교가 같은 Google 이메일로 운영 사이트에 처음 로그인한다. `api/firebase-login.js`는 서명·프로젝트·이메일 인증을 확인하고 Supabase 로그인용 Firebase `role=authenticated` claim만 자동으로 설정한다. 서버 비밀 키는 `FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON` 환경변수에만 둔다. 앱 역할이나 승인 상태는 설정하지 않는다.
3. 앱은 새 ID 토큰을 받아 사전 등록된 조교 이메일과 DB 계정을 연결한다. 일치하는 직원이 없으면 앱 접근은 거부되고, 일치하면 승인 대기 상태가 된다.
4. 관리자가 조교 탭을 새로고침하고 앱 권한에서 역할과 승인 상태를 저장한다. 관리자의 최종 승인은 계속 필요하다.

서버 환경변수가 없는 로컬 개발 환경이나 Preview에서는 신규 계정의 자동 연결을 사용할 수 없다. 운영용 서비스 계정 JSON을 Git이나 `EXPO_PUBLIC_` 변수에 넣지 않는다. 계정별 로컬 도구 `supabase/tools/provision-firebase.mjs`는 서버 장애 때만 수동 복구 용도로 사용한다.

## 검증

```powershell
cd D:\Workspace\hongsi\supabase\tests
npm test
cd D:\Workspace\hongsi
node --env-file=.env.local supabase/tests/development-readonly.mjs
npx tsc --noEmit
node node_modules/expo/bin/cli export --platform web --max-workers 2 --output-dir supabase/.local/web-export
```

- 구조 테스트 30개, 역할별 접근 테스트 33개 통과.
- 실제 개발 DB에서 학생·계좌·분기·수업·위치·임시 보강 참여와 본인 권한, 학생 등록, 개별/전체 기록, 분기·수업·차시 관리, 전반·수강 종료/재개·보강 참여, 조교 계정 연결·출퇴근 RPC의 익명 요청 차단을 확인했다. 수업 조회 테스트는 앱과 같은 중첩 관계 쿼리를 사용한다.
- 2026-09-20 첫 관리자 등록 SQL의 실행·재실행 차단을 로컬 PostgreSQL에서 확인한 뒤 개발 DB에 적용했다. 실제 Firebase ID 토큰 → 개발 API 관리자 조회 및 직원 신원 일치 검증 통과, 익명 요청 차단 5개 재확인 통과.
- 2026-09-20 권한 게이트와 수업·위치·차시 조회를 연결했다. 2026-09-23 `class_code`를 제거하고 DB가 생성하는 `classes.id`를 수업 식별자로 통일했다. 2026-09-24 로그인/권한 확인 순서의 화면 전환 경합과 홈의 불필요한 Sheets 대기를 제거했고, 사용자가 입력한 첫 수업·차시의 빠른 조회와 새로고침을 확인했다. 같은 날 학생 등록·수강 배정·차시 기록 RPC를 개발 DB에 적용했다. 2026-09-25 학생 ID 자동 생성, 연락처 검증, 수업별 학생 관리, 차시 전체 표 입력, 항목 수정·삭제·통계, 분기·수업·차시 관리 기능을 개발 DB와 앱에 적용했다.
- 2026-09-26 수강 상태·같은 분기 전반·수강 종료/재개, A/B 보강 차시 직접 연결, 전체 학생 기록 조회, 새 일정의 예정 근무자 선택을 개발 DB와 앱에 적용했다.
- 2026-10-01 조교 계정 연결·출퇴근 RPC와 근무명 요일 표시 SQL을 개발 DB SQL Editor에서 적용하고 성공 응답을 확인했다. 조교/근무 기록 화면은 로컬 웹 빌드까지 확인했으며, 조교 본인 계정으로 하는 실제 UI 검증은 별도로 필요하다.
- 2026-10-07 매니저의 계좌 조회 정책과 모든 승인 계정의 수업별 근무 시간 요약 RPC를 개발 DB SQL Editor에서 적용했다. 적용 후 조회에서 새 정책 1개, 기존 관리자 전용 조회 정책 0개, 새 함수 1개, `authenticated` 실행 허용과 `anon` 실행 차단을 확인했다. 개발 DB 모드 UI에는 출근 시작 시각, 수업별 근무표, 앱 권한 안내·현재 역할, 읽기 쉬운 선택 메뉴를 반영했다. 실제 계정별 UI 동작은 별도로 확인해야 한다.
- 2026-10-08 계좌 저장 RPC와 분 단위 근무시간 계산 SQL을 개발 DB에 적용했다. 근무시간은 출퇴근 시각의 초를 버리고 분 경계의 차이로 계산한다. 계좌 수정은 관리자 전용 RPC를 통해 신규 행과 기존 행 모두 저장한다.
- 2026-10-08 문자 대기열·수신자별 상태·Android 기기 비밀값 인증 SQL과 차시 담당자 메시지 선점 보완 SQL을 개발 DB에 적용했다. 실행 결과는 `Success. No rows returned`였고, 새 RPC를 포함한 익명 API 접근 차단을 확인했다. 개발 DB의 장소 삭제 RPC도 적용했으며, 수업·일정에서 쓰는 장소는 삭제되지 않는다. 실제 문자 발송은 하지 않았다.
- TypeScript 타입 검사, Expo 웹 빌드(정적 경로 16개), Android 디버그 Java 컴파일을 통과했다. 출력은 Git에서 제외되는 로컬 검증 디렉터리에만 생성했다.
- 권한 테스트는 PostgreSQL 안에서 이미 검증된 JWT claims를 가정한다. 실제 JWT 서명 검증, Firebase 사용자 중지/토큰 갱신, 기기 인증 및 동시 요청은 이 테스트가 증명하지 않는다.
- 타입 검사 중 발견한 기존 잘못된 `./App` 진입점 참조와 웹 전용 Picker 스타일 타입을 수정했다.

공식 연동 기준: [Supabase Firebase Auth](https://supabase.com/docs/guides/auth/third-party/firebase-auth).
