# 개발 DB 적용 및 Firebase 연결 상태

작성: 2026-09-13 · 갱신: 2026-09-26 · 브랜치 `codex/migrate-to-supabase`

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
- 초기 적용 시 조회 결과: **테이블 20 / RLS 활성 20 / 정책 54 / 직원 0 / 학생 0**. 2026-09-20 첫 관리자 직원 1명을 추가했다.
- 실제 개발 REST API 검증: 공개 키만 사용한 학생·계좌정보·`get_my_access` 요청 모두 HTTP 401.
- 매니저/관리자 모두 기기 등록·허용·차단 가능. 계정 승인·계좌 조회는 관리자만 가능.
- 2026-09-19 Supabase Third-Party Auth 화면에서 Firebase 프로젝트 `hongsi-assistant` 연결의 **ENABLED** 상태를 확인했다. 이미 등록되어 있어 중복 생성하지 않았다.
- `.env.local`에 개발 프로젝트 URL과 Publishable key를 설정했다. 비밀 키는 사용하지 않았으며 이 파일은 Git에서 제외된다. 다른 환경에서는 `.env.example`을 복사하고 공개 키를 채운다.

적용된 SQL은 수정하지 않는다. SQL Editor 실행은 CLI의 migration history에 자동 등록되지 않으므로, CLI `db push`를 쓰기 전에 아홉 버전이 적용된 것을 확인하고 `migration repair --status applied`로 이력을 동기화해야 한다. 같은 SQL을 다시 실행하지 않는다.

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

현재 서비스 계정 파일은 알려준 경로에서 더 이상 확인되지 않는다. 앱 실행에는 필요하지 않으며, 이후 다른 Firebase 사용자에게 로그인 claim을 설정할 때만 다시 준비하면 된다.

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

적용 뒤에는 검증된 UID·이메일·표시 이름·프로젝트 ID만 `supabase/.local/firebase-user.json`에 보관한다. 관리자 도구를 실행했다고 DB의 관리자 권한이나 승인 상태가 자동 생성되지는 않는다. 이번 첫 관리자 DB 등록은 별도 SQL로 완료했다. 신규 조교도 계정을 연결할 때 로그인 claim 설정이 필요하다. 자동 계정 연결·승인 UI는 이후 단계에 구현한다.

`supabase/tools/verify-firebase-access.mjs`는 기존의 인증된 관리자만 대상으로 custom-token 로그인을 수행하고 개발 DB를 읽는다. DB 쓰기나 역할 변경은 하지 않으며 ID 토큰과 refresh token은 프로세스 메모리에서만 사용한다. 로그인으로 Firebase의 마지막 로그인 시각은 갱신될 수 있다. Google 로그인 UI 검증을 대신하지 않는다.

```powershell
cd D:\Workspace\hongsi
# 위에서 설정한 GOOGLE_APPLICATION_CREDENTIALS 사용
node --env-file=.env.local supabase/tools/verify-firebase-access.mjs --email 'hongsi20222@gmail.com'
```

## 앱 연결 코드

- `lib/supabase.ts`: 공식 Supabase 클라이언트. Firebase ID 토큰을 요청별로 전달하고, Supabase 자체 로그인 세션을 중복 관리하지 않는다. claim이 없으면 한 번 강제 갱신 후 안내 오류를 반환한다. 토큰 확인·갱신에는 각각 10초, DB 네트워크 요청에는 15초 제한이 있고 쓰기를 자동 재시도하지 않는다.
- `utils/appAccess.ts`: 본인 접근 상태 조회와 관리자 전용 계정 승인 RPC 호출. Firebase UID/승인 여부는 DB가 결정한다.
- `contexts/AppAccessContext.tsx`와 `components/AppAccessGate.tsx`: 개발 DB 모드에서 로그인 직후 승인 상태와 역할을 확인한다. 미등록·승인 대기·중지·비활성 계정은 업무 화면 대신 상태 안내를 본다.
- `lib/classData.ts`: 수업 목록, 위치, 수업 상세·차시·수강생·차시 기록을 개발 DB에서 조회한다. 장소와 학생 정보, 숙제·시험 항목도 DB에 저장한다.
- `EXPO_PUBLIC_DATA_SOURCE=supabase`인 로컬 개발 환경에서 위 연결을 사용한다. 값이 없거나 `sheets`이면 기존 Sheets 화면 흐름을 사용하므로 Vercel 운영 사이트는 환경변수를 바꾸기 전까지 영향을 받지 않는다.
- 개발 DB의 웹 로그인은 Google Drive 범위를 요청하거나 Sheets용 Google 액세스 토큰을 기다리지 않는다. 승인된 계정으로 진입한 홈 화면도 기존 조교·권한·출퇴근 시트를 읽지 않고 즉시 개발 모드 안내를 표시한다. 운영 Sheets 모드의 기존 Google Drive 로그인과 홈 화면은 유지한다.
- 수업 상세에서 수강 학생을 등록·수정한다. 학생 ID를 비우면 `S`와 임의 영문·숫자로 자동 생성하며, 한국 휴대전화 번호와 이메일 형식을 앱과 DB 양쪽에서 검사한다.
- 학생 ID는 분기와 무관하게 계속 유지된다. 수강 관계는 `수강 중/전반/퇴원`으로 관리하고, 같은 분기 전반 시 이전 반의 종료일과 새 반의 시작일을 한 트랜잭션으로 저장한다. 이전 차시 기록은 원래 반에 남는다.
- 다른 반에 한두 번 보강 오는 학생은 정식 수강생으로 중복 등록하지 않는다. B 차시의 **다른 반 보강 학생**에서 원래 A 차시를 선택하면, A에는 다른 반 보강 상태가 자동 생성되고 B에서 출석·숙제·시험을 입력할 수 있다. A/B의 날짜 순서는 제한하지 않으며 **전체 학생 기록**에서 양쪽 연결을 확인한다.
- 차시 화면은 수강생 전체를 가로 표로 보여 준다. 저장된 출석·보강·복수 숙제·복수 시험 결과가 다시 표시되고, 여러 학생을 고친 뒤 표 전체를 한 번에 저장한다. 전체 저장 RPC가 한 트랜잭션으로 처리하므로 한 행이라도 잘못되면 어느 행도 바뀌지 않는다. 빈 결과를 저장하면 숙제·시험을 다시 `미입력`으로 되돌릴 수 있다.
- 수업 탭의 분기/수업 관리에서 분기와 수업을 추가·수정·보관 삭제한다. 수업 상세에서는 단일 또는 반복 차시 일정을 추가하고, 새 일정마다 예정 근무자를 선택할 수 있다. 삭제한 분기·수업은 연결된 기록을 보존하기 위해 비활성화하며, 숙제·시험 항목 삭제는 확인 뒤 학생 결과까지 한 트랜잭션으로 실제 삭제한다.
- 차시 기록은 학생 이름 가나다순이며, 숙제 등급별 인원과 시험의 만점·평균·최고·최저·결시 통계를 입력 중에도 계산한다.
- 조교 출퇴근과 문자 기능은 아직 DB 구현 전이다. 개발 DB 모드에서는 해당 입력 기능을 숨겨 DB 수업 ID가 기존 Sheets 수업 ID로 잘못 사용되지 않게 했다. 운영 Sheets 모드의 기존 기능은 유지한다.
- 사용자가 데이터를 직접 입력하기로 했으므로 별도 데이터 이전 도구는 만들지 않는다. 입력 순서는 `docs/manual-data-entry.md`에 정리했다.
- 문자 생성·기기 인증·발송 선점/결과 갱신, 조교 출퇴근 등 전용 RPC는 후속 구현이다. 기기 목록에 등록했다는 것만으로 문자 발송 권한이 생기는 방식은 사용하지 않는다.

## 검증

```powershell
cd D:\Workspace\hongsi\supabase\tests
npm test
cd D:\Workspace\hongsi
node --env-file=.env.local supabase/tests/development-readonly.mjs
npx tsc --noEmit
node node_modules/expo/bin/cli export --platform web --max-workers 2 --output-dir supabase/.local/web-export
```

- 구조 테스트 30개, 역할별 접근 테스트 24개 통과.
- 실제 개발 DB 익명 요청 차단 21개 통과. 학생·계좌·분기·수업·위치·임시 보강 참여와 본인 권한, 학생 등록, 개별/전체 기록, 분기·수업·차시 관리, 전반·수강 종료/재개·보강 참여 RPC가 모두 HTTP 401로 차단됐다. 수업 조회 테스트는 앱과 같은 중첩 관계 쿼리를 사용한다.
- 2026-09-20 첫 관리자 등록 SQL의 실행·재실행 차단을 로컬 PostgreSQL에서 확인한 뒤 개발 DB에 적용했다. 실제 Firebase ID 토큰 → 개발 API 관리자 조회 및 직원 신원 일치 검증 통과, 익명 요청 차단 5개 재확인 통과.
- 2026-09-20 권한 게이트와 수업·위치·차시 조회를 연결했다. 2026-09-23 `class_code`를 제거하고 DB가 생성하는 `classes.id`를 수업 식별자로 통일했다. 2026-09-24 로그인/권한 확인 순서의 화면 전환 경합과 홈의 불필요한 Sheets 대기를 제거했고, 사용자가 입력한 첫 수업·차시의 빠른 조회와 새로고침을 확인했다. 같은 날 학생 등록·수강 배정·차시 기록 RPC를 개발 DB에 적용했다. 2026-09-25 학생 ID 자동 생성, 연락처 검증, 수업별 학생 관리, 차시 전체 표 입력, 항목 수정·삭제·통계, 분기·수업·차시 관리 기능을 개발 DB와 앱에 적용했다.
- 2026-09-26 수강 상태·같은 분기 전반·수강 종료/재개, A/B 보강 차시 직접 연결, 전체 학생 기록 조회, 새 일정의 예정 근무자 선택을 개발 DB와 앱에 적용했다.
- TypeScript 타입 검사와 Expo 웹 빌드 통과(정적 경로 16개). 출력은 Git에서 제외되는 로컬 검증 디렉터리에만 생성했다.
- 권한 테스트는 PostgreSQL 안에서 이미 검증된 JWT claims를 가정한다. 실제 JWT 서명 검증, Firebase 사용자 중지/토큰 갱신, 기기 인증 및 동시 요청은 이 테스트가 증명하지 않는다.
- 타입 검사 중 발견한 기존 잘못된 `./App` 진입점 참조와 웹 전용 Picker 스타일 타입을 수정했다.

공식 연동 기준: [Supabase Firebase Auth](https://supabase.com/docs/guides/auth/third-party/firebase-auth).
