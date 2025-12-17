# 김연주T 통합 웹/앱 개발

## 실행을 위한 순서
1. 컴퓨터에 Node.js를 설치한다. (https://nodejs.org/ko/download) (아래 쪽의 msi 파일)
2. 아래 명령어를 powershell을 열어 시행해본다.
```bash
node -v
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
npm -v
```
3. 아래 세 Extension을 Visual Studio Code에서 설치한다.
- ES7+ React/Redux/React-Native snippets
- Prettier - Code formatter
- Expo Tools
4. git clone 으로 소스코드를 받고 프로젝트 디렉토리로 이동한다.
- git이 없으면 (https://git-scm.com/)에서 git을 설치한다.
```bash
git clone https://github.com/hanjj753/hongsi.git
cd hongsi20222
```
5. npm 명령어로 필요한 패키지를 자동으로 다운받는다.
```bash
npm install
```
6. npx expo start 명령어로 localhost를 열고 Expo Go 앱으로 들어간다.
- DEPRECATED;;

## APK 파일 굽기
1. JDK 17 버전 설치 (https://www.oracle.com/java/technologies/javase/jdk17-archive-downloads.html)
2. Android Studio 설치 (https://developer.android.com/studio?hl=ko) 아래에 exe 파일
- Android Studio를 설치 후 실행하면 아래 것들을 설치할 수 있음.
- Android SDK, Android SDK Platform, Android Virtual Device 설치
- 위의 파일들 모두 설치 후 Android Studio를 실행했을 때, [More Actions]에서 [SDK Manager]을 선택하고, [SDK Tools]에 들어가 [Show Package Details]를 누른 뒤, [Android SDK Build-Tools]에는 36.1.0, 35.0.0, 34.0.0을 모두 선택하고, NDK에는 26.1.10909125을 선택한 뒤 Apply를 눌러 설치한다.
3. ANDROID_HOME, Path 환경 변수 설정.
- ANDROID_HOME 에는 ```C:\Users\사용자명\AppData\Local\Android\Sdk```
- Path 변수에는 ```C:\Users\사용자명\AppData\Local\Android\Sdk\platform-tools```
4. 아래 명령어 실행하면 android/app/build/outputs/apk/release 아래에 apk 파일이 만들어짐.
```bash
cd android
./gradlew --stop
./gradlew clean
./gradlew assembleRelease
```
5. 만약 명령어 실패하면, 아래 프로세스를 따른다.
```bash
cd android
./gradlew --stop
./gradlew clean
<코드 오류 수정>
./gradlew assembleRelease
```
6. 만약 eas 를 쓴다면, git commit 후 ```eas build -p android --profile preview``` 명령어 사용.

## 웹 화면 보기
1. 아래 명령어를 실행
```bash
npx expo start --web
```

## 문자 테스트 시트 API 주소
REMOVED_PRIVATE_SCRIPT_URL

## 앱 이름 변경
1. app.json에서 {expo : {"name": ""}} 부분을 직접 변경
2. android/app/src/main/res/values/strings.xml에서 <string name="app_name">에 있는 내용 변경
