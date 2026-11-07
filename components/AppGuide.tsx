import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const chapters = [
  {
    title: '1. 로그인과 화면 이동',
    paragraphs: [
      '웹사이트 또는 Android 앱에서 Google 계정으로 로그인합니다. 조교 탭에 현역으로 등록된 이메일이면 첫 로그인 때 자동으로 연결됩니다. 등록되지 않은 이메일은 로그인할 수 없습니다. 홈의 마이 페이지에서 현재 앱 권한을 확인할 수 있습니다.',
      '아래 탭에서 홈·수업·달력·조교·문의를 이동합니다. 권한이나 연결 상태가 바뀌었다면 화면을 새로고침하거나 앱을 다시 열어 확인해 주세요.',
    ],
  },
  {
    title: '2. 분기와 수업 만들기',
    paragraphs: [
      '수업 탭에서 분기를 고르면 그 분기의 수업이 보입니다. 매니저 또는 관리자는 상단의 ‘분기 및 수업 관리’를 열어 ‘+ 분기 추가’로 분기를 만든 뒤, 해당 분기를 선택하고 ‘+ 수업 추가’를 누를 수 있습니다.',
      '일반 수업은 학교·과목을 적고 요일을 선택합니다. 선택한 요일마다 오전·오후·저녁과 시작·종료 시간을 따로 정한 뒤 장소, 기본 시급, 기본 예정 근무자를 확인하고 저장하세요. 기본 예정 근무자는 나중에 일정을 만들 때 미리 선택됩니다.',
      '클리닉을 만들 때는 수업 추가 화면의 ‘클리닉 수업’을 선택합니다. 학교·과목은 입력하지 않고 요일별 시간과 장소 등을 정합니다. 클리닉은 분기마다 하나만 만들 수 있고, 같은 분기의 여러 반 학생이 차시마다 참여할 수 있습니다.',
      '수업을 저장한 뒤 해당 수업 화면의 ‘+ 일정 추가’에서 차시 날짜와 예정 근무자를 등록하세요. 정기 수업은 ‘반복 등록’에서 요일과 주 수 또는 종료일을 선택하면 여러 차시를 한꺼번에 만들 수 있습니다. 날짜·비고·근무자는 각 일정의 수정 기능에서 바꿀 수 있습니다.',
    ],
  },
  {
    title: '3. 학생 등록·전반·보강',
    paragraphs: [
      '일반 수업을 열고 ‘수강 학생’의 ‘학생 등록’을 누르면 학생 정보와 수강 시작일을 입력할 수 있습니다. 학생 ID를 비워 두면 자동 생성됩니다. 같은 학생은 수업이 달라도 같은 ID를 쓰며, 전화번호와 기본 문자 수신자(학부모만/학생과 학부모 모두)는 학생 정보에서 관리합니다.',
      'Android 앱의 ‘연락처 추가’를 누르면 수강 중인 학생과 학부모의 전화번호를 분기 이름의 연락처 그룹에 저장합니다. 이름은 ‘분기 학교 학생 이름’, 학부모는 끝에 ‘모’를 붙입니다. 같은 번호가 이미 있으면 이름을 수정합니다. 연락처 읽기·쓰기 권한이 필요합니다.',
      '같은 분기에서 다른 수업으로 옮길 때는 이전 수업의 ‘학생 전반’을 누르고 학생·새 수업·전반일을 선택하세요. 전반일 전 기록은 이전 수업에 남고, 전반일부터 새 수업의 학생 명단에 표시됩니다. 한두 번만 다른 반에 가는 경우에는 전반하거나 학생을 다시 등록하지 않습니다.',
      '전반한 학생은 양쪽 반의 ‘전반 이력 N건 보기’에서 옮긴 날짜와 이전·새 수업을 확인할 수 있습니다. 전체 학생 기록에서는 ‘전체 분기’ 또는 특정 분기를 선택한 뒤 검색하세요. ‘출석 현황’을 누르면 선택한 분기의 수업별 학생 출석을 표로 봅니다. 빨간색 ↔는 전반, 파란색은 보강·클리닉 참여이며 출석 칸을 누르면 상세 내역이 나옵니다. 수강 기간 밖은 보라색 미등록, 수강 중 빈 출석은 미입력, 해당 차시 일정이나 임시 참여가 없으면 —로 표시합니다. 수업이 바뀌는 곳은 진한 가로선과 배경색으로 구분합니다.',
      '다른 반에서 실제로 보강할 수업 B의 차시를 열어 ‘다른 반 보강 학생’을 누르세요. 학생과 원래 수업 A를 고르고, A에서 보강으로 처리할 차시를 선택한 뒤 ‘차시에 추가’를 누릅니다. 원래 차시가 아직 없으면 A의 일정을 먼저 추가하세요. A와 B의 날짜는 어느 쪽이 먼저여도 됩니다.',
      '보강을 연결하면 A의 해당 차시에는 다른 반 보강 사실이 남고, B에는 일시 참여한 학생으로 표시됩니다. 출석·숙제·시험 결과는 실제로 참여한 B 차시에서 입력하세요. 전체 학생 기록에서도 두 수업의 관계를 확인할 수 있습니다. 클리닉은 클리닉 차시의 ‘클리닉 참여 학생’에서 같은 분기의 학생을 추가합니다.',
    ],
  },
  {
    title: '4. 일정과 차시 기록',
    paragraphs: [
      '수업에서 차시를 선택하면 출석, 숙제, 시험 결과를 입력할 수 있습니다. 숙제·시험 항목을 먼저 추가한 뒤 학생별 값을 적고 ‘전체 저장’을 누르세요. 컴퓨터 웹에서는 ‘빠른 입력’으로 표를 열어 Tab으로 다음 칸, Enter로 같은 항목의 다음 학생에게 이동할 수 있습니다. 잘못된 점수나 형식은 붉게 표시되어 수정 전에는 저장할 수 없습니다.',
      '시험은 점수형과 결과형으로 만들 수 있습니다. 점수형에는 만점과 학생 점수를, 결과형에는 통과·재시 같은 결과 문구를 적습니다. 시험 오답표에서는 틀린 문항을 표시하고 PDF로 출력할 수 있습니다.',
      '저장 버튼이 흐리면 아직 저장할 변경사항이 없습니다. 차시를 나가기 전에 저장하지 않은 변경사항이 있으면 확인창이 나타납니다.',
    ],
  },
  {
    title: '5. 조교와 근무 기록',
    paragraphs: [
      '조교 탭에서는 내 정보와 근무 기록을 확인합니다. 출근을 누른 뒤 퇴근을 누르면 근무 시간이 기록됩니다. 수업 화면에서는 그 수업의 근무 내역을 볼 수 있고, 관리자는 표의 ‘수정’으로 근무명·날짜·출퇴근 시간·시급·비고를 고칠 수 있습니다.',
      '매니저와 관리자는 조교 정보와 근무 기록을 관리하고 문자 발송 기기를 허용할 수 있습니다. 조교를 추가하면 등록된 이메일로 바로 로그인할 수 있습니다. 앱 역할 변경과 계좌 수정은 관리자 권한이 필요합니다.',
    ],
  },
  {
    title: '6. 문자 작성과 발송',
    paragraphs: [
      '수업 화면에서는 공지 메시지를, 각 차시 화면에서는 그 차시의 개별 메시지를 대기 목록에 추가합니다. 학생의 기본 수신 설정에 따라 학부모만 또는 학부모와 학생 모두에게 보낼 수 있습니다. 전화번호가 없는 대상은 선택할 수 없습니다.',
      '차시에서 숙제와 시험을 추가하면 HW1, HW2 및 TEST1, TEST2처럼 변수가 붙습니다. 메시지 내용에 ${HW1}, ${TEST1}을 적으면 학생별 해당 결과로 바뀝니다. 학생 기록을 먼저 저장하고 미리보기를 확인한 뒤 대기 목록에 추가해 주세요.',
      '대기 목록에 추가하는 것만으로 문자가 전송되지는 않습니다. 허용된 Android 기기에서 대기 문자 발송을 눌러야 실제 발송을 시도합니다. 진행 상태와 실패 건수는 메시지 화면에서 확인할 수 있습니다.',
      '대기 메시지는 각각 수정하거나 취소할 수 있습니다. 한 메시지를 취소하면 아직 대기 중인 수신자만 취소되며, 이미 전송 중이거나 기기에 제출된 수신자는 취소되지 않습니다.',
    ],
  },
  {
    title: '7. Android 문자 발송 기기 등록',
    paragraphs: [
      '문자를 보낼 Android 앱에서 해당 수업의 메시지 → 이 기기 등록 요청을 누릅니다. 매니저 또는 관리자가 조교 탭의 발송 기기 관리에서 기기를 허용합니다. 이후 메시지 화면에서 승인 상태 새로고침을 눌러 발송 허용을 확인합니다.',
      'SMS 권한이 회색으로 막힌 기기에서는 다음 순서로 제한된 설정을 허용해 주세요. ① 휴대전화 설정을 엽니다. ② 애플리케이션으로 이동합니다. ③ 이 앱을 선택합니다. ④ 오른쪽 위 더보기(⁝)를 누릅니다. ⑤ 제한된 설정 허용을 선택하고 본인 인증을 합니다. ⑥ 앱 정보의 권한에서 SMS를 허용합니다.',
      '기종이나 Android 버전에 따라 메뉴 이름과 위치가 다를 수 있습니다. 이 설정은 설치한 앱과 발송 기기를 본인이 확인한 경우에만 진행해 주세요.',
    ],
  },
  {
    title: '8. DB 사용량과 오래된 기록 정리',
    paragraphs: [
      '수업 탭의 ‘분기/수업 관리’를 열면 DB 사용량과 무료 한도 대비 비율이 나옵니다. ‘새로고침’으로 다시 확인할 수 있습니다. 90% 이상이면 오래된 수업 기록을 정리해 주세요.',
      '먼저 삭제할 수업과 그 안의 출석·숙제·시험·문자 기록이 더는 필요 없는지 확인하세요. 분기를 먼저 삭제하지 말고, 분기/수업 관리에서 해당 분기를 선택해 수업의 ‘삭제’를 누릅니다. 이 단계는 수업을 숨길 뿐 기록과 DB 용량은 그대로입니다.',
      '같은 목록에 ‘삭제됨’으로 표시된 수업의 ‘완전 삭제’를 누르고 확인하면 해당 수업의 차시·수강·성적·문자·보강 기록이 영구 삭제됩니다. 여러 수업에서 공유하는 학생 기본 정보와 근무 기록은 남고, 근무 기록의 수업 연결만 해제됩니다. 완전 삭제는 복구할 수 없으므로 필요한 기록은 먼저 별도로 보관하세요.',
      '정리 후 DB 사용량의 ‘새로고침’을 눌러 확인하세요. 이 숫자는 DB 파일의 물리적 크기이므로 삭제 직후 바로 줄지 않을 수 있습니다. PostgreSQL이 빈 공간을 다음 데이터에 재사용하며, 자동 정리 후에도 파일 크기가 그대로일 수 있습니다. 삭제가 반영됐는지는 수업 목록과 기록 건수로 확인하세요.',
    ],
  },
  {
    title: '9. 문의와 문제 해결',
    paragraphs: [
      '문의 탭에서 문의 내용을 적고 접수하면 내 문의 내역에서 상태를 볼 수 있습니다. 매니저와 관리자는 문의를 확인하고 해결 처리할 수 있습니다.',
      '기록이 보이지 않으면 먼저 올바른 분기·수업·차시를 선택했는지 확인하고 화면을 새로고침해 주세요. 로그인 문제가 계속되면 현재 계정과 화면의 오류 문구를 문의에 적어 주세요.',
    ],
  },
];

export function AppGuide() {
  const [visible, setVisible] = useState(false);
  const [chapter, setChapter] = useState<number | null>(0);

  return <>
    <Pressable style={styles.openButton} onPress={() => setVisible(true)}>
      <Ionicons name="book-outline" size={19} color="#4338CA" />
      <Text style={styles.openText}>웹·앱 사용 안내 보기</Text>
      <Ionicons name="chevron-forward" size={18} color="#4338CA" />
    </Pressable>
    <Modal visible={visible} animationType="slide" onRequestClose={() => setVisible(false)}>
      <View style={styles.modal}>
        <View style={styles.header}>
          <View style={styles.headerTitle}>
            <Ionicons name="book-outline" size={23} color="#4338CA" />
            <Text style={styles.title}>웹·앱 사용 안내</Text>
          </View>
          <Pressable accessibilityLabel="사용 안내 닫기" onPress={() => setVisible(false)} style={styles.close}>
            <Ionicons name="close" size={25} color="#374151" />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.intro}>궁금한 항목을 눌러 사용 방법을 확인해 주세요.</Text>
          {chapters.map((item, index) => <View key={item.title} style={styles.chapter}>
            <Pressable style={styles.chapterHeader} onPress={() => setChapter(chapter === index ? null : index)}>
              <Text style={styles.chapterTitle}>{item.title}</Text>
              <Ionicons name={chapter === index ? 'chevron-up' : 'chevron-down'} size={19} color="#4B5563" />
            </Pressable>
            {chapter === index && <View style={styles.chapterBody}>{item.paragraphs.map((paragraph) =>
              <Text key={paragraph} style={styles.paragraph}>{paragraph}</Text>)}</View>}
          </View>)}
        </ScrollView>
      </View>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  openButton: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 15, borderRadius: 11, borderWidth: 1, borderColor: '#C7D2FE', backgroundColor: '#EEF2FF', marginBottom: 18 },
  openText: { flex: 1, color: '#312E81', fontWeight: '800', fontSize: 15 },
  modal: { flex: 1, backgroundColor: '#F6F7FB' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 17, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  headerTitle: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  title: { fontSize: 19, fontWeight: '800', color: '#111827' },
  close: { padding: 5 },
  content: { width: '100%', maxWidth: 760, alignSelf: 'center', padding: 18, paddingBottom: 55 },
  intro: { color: '#6B7280', lineHeight: 21, marginBottom: 13 },
  chapter: { borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 11, backgroundColor: '#FFFFFF', marginBottom: 9, overflow: 'hidden' },
  chapterHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 15, paddingVertical: 17 },
  chapterTitle: { flex: 1, color: '#111827', fontWeight: '800', fontSize: 15 },
  chapterBody: { paddingHorizontal: 15, paddingBottom: 16, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  paragraph: { color: '#374151', lineHeight: 23, marginTop: 12, fontSize: 14 },
});
