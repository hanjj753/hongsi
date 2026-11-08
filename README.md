# 김연주T 통합 웹/앱 개발

수업과 학생 기록, 조교 업무를 한곳에서 관리하는 웹·모바일 앱입니다. **김연주T 과학** 수업 운영을 위해 만들어졌으며, Expo와 React Native를 기반으로 합니다.

## 주요 기능

- **수업 관리** — 분기·수업·차시 일정을 관리하고 학생의 수강 및 반 이동 이력을 확인합니다.
- **학생 기록** — 출석, 숙제, 시험 결과와 보강 기록을 차시별로 입력, 메시지를 발송할 때 활용합니다.
- **조교 업무** — 근무 일정과 출퇴근 기록을 관리하고 역할에 따라 접근 권한을 구분합니다.
- **일정과 소통** — 달력에서 일정을 확인하고 문의와 문자 발송 업무를 관리합니다.

## 기술 구성

| 영역 | 기술 |
| --- | --- |
| 앱과 웹 | Expo, React Native, React, TypeScript, Expo Router |
| 인증 | Firebase Authentication, Google 로그인 |
| 데이터 | Supabase (PostgreSQL) |
| 배포 | Expo Application Services (EAS), Vercel |

## 시작하기

Node.js와 npm이 필요합니다. Android 네이티브 빌드에는 JDK 17과 Android Studio 및 Android SDK가 추가로 필요합니다.

```bash
git clone https://github.com/hanjj753/hongsi.git
cd hongsi
npm ci
```

`.env.example`을 `.env.local`로 복사한 뒤 본인의 Supabase 프로젝트 URL과 Publishable key를 입력합니다. 기본 데이터 소스는 Supabase이며, Firebase 인증 연동과 데이터베이스 접근 권한도 준비되어 있어야 실제 데이터를 사용할 수 있습니다.

```bash
# 개발 서버
npm start

# 웹
npm run web

# 네이티브 개발 빌드
npm run android
npm run ios
```

네이티브 앱은 Firebase와 Google 로그인을 위한 네이티브 모듈을 사용하므로 별도의 개발 빌드와 플랫폼별 Firebase 설정이 필요합니다. iOS 네이티브 빌드에는 macOS 환경이 필요합니다.

## 빌드

EAS CLI와 프로젝트 접근 권한을 준비한 후 미리보기 빌드를 만들 수 있습니다.

```bash
eas build --platform android --profile preview
eas build --platform ios --profile preview
```

## 프로젝트 구조

```text
app/                 화면과 라우팅
components/          공통 UI 및 업무 화면
config/              데이터 소스와 서비스 설정
lib/                 데이터 조회 및 업무 로직
supabase/            데이터베이스 마이그레이션과 검증 도구
google_apps_script/  이전 Google Sheets 연동 스크립트 (현재 미사용)
docs/                데이터베이스 및 운영 문서
```

## 개발 문서

- [데이터베이스 설계](docs/database-design.md)
- [데이터베이스 설정](docs/database-setup.md)
- [초기 데이터 입력](docs/manual-data-entry.md)

서비스 계정 키와 비밀번호 같은 비밀값은 저장소에 커밋하거나 `EXPO_PUBLIC_` 환경 변수에 넣지 않도록 주의. `EXPO_PUBLIC_` 값은 앱에 포함되는 공개 설정입니다.
