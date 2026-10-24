import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const chapters = [
  {
    title: '1. 로그인과 화면 이동',
    paragraphs: [
      '웹사이트 또는 Android 앱에서 Google 계정으로 로그인합니다. 계정이 승인되어야 수업 기록을 사용할 수 있습니다. 홈의 마이 페이지에서 현재 앱 권한을 확인할 수 있습니다.',
      '아래 탭에서 홈·수업·달력·조교·문의를 이동합니다. 권한이나 연결 상태가 바뀌었다면 화면을 새로고침하거나 앱을 다시 열어 확인해 주세요.',
    ],
  },
  {
    title: '2. 수업과 학생',
    paragraphs: [
      '수업 탭에서 분기를 고르고 수업을 누릅니다. 수업 화면의 수강 학생에서 학생을 등록하거나 전화번호, 기본 문자 수신자, 수강 시작일을 수정할 수 있습니다. 학생 ID를 비워 두면 자동 생성됩니다.',
      '학생 기록은 수업을 옮겨도 같은 학생 ID로 연결됩니다. 전반은 기존 수업 기록을 남긴 채 새 수업으로 옮기는 기능입니다. 다른 반에서 한두 번 보강하는 경우에는 해당 차시의 보강 학생 기능을 사용합니다.',
      '수업 목록의 전체 학생 기록에서는 여러 수업의 기록을 함께 확인할 수 있습니다. 매니저와 관리자는 분기·수업 및 수강 상태를 관리합니다.',
    ],
  },
  {
    title: '3. 일정과 차시 기록',
    paragraphs: [
      '수업에서 차시를 선택하면 출석, 숙제, 시험 결과를 입력할 수 있습니다. 여러 학생의 결과는 표에서 한 번에 입력한 뒤 저장할 수 있습니다. 저장 버튼이 흐리면 아직 변경된 내용이 없는 상태입니다.',
      '시험은 점수형과 결과형으로 만들 수 있습니다. 점수형에는 만점과 학생 점수를, 결과형에는 통과·재시 같은 결과 문구를 적습니다. 시험 오답표에서는 틀린 문항을 표시하고 PDF로 출력할 수 있습니다.',
      '일정 추가에서는 반복할 요일과 기간을 정해 여러 차시를 한꺼번에 만들 수 있습니다. 날짜나 비고가 바뀌면 일정에서 수정합니다.',
    ],
  },
  {
    title: '4. 조교와 근무 기록',
    paragraphs: [
      '조교 탭에서는 내 정보와 근무 기록을 확인합니다. 출근을 누른 뒤 퇴근을 누르면 근무 시간이 기록됩니다. 수업 화면에서도 그 수업의 근무 내역을 볼 수 있습니다.',
      '매니저와 관리자는 조교 정보와 근무 기록을 관리하고 문자 발송 기기를 허용할 수 있습니다. 계정 승인과 계좌 수정은 관리자 권한이 필요합니다.',
    ],
  },
  {
    title: '5. 문자 작성과 발송',
    paragraphs: [
      '수업의 메시지에서 공지 또는 차시별 개별 메시지를 대기 목록에 추가합니다. 학생의 기본 수신 설정에 따라 학부모만 또는 학부모와 학생 모두에게 보낼 수 있습니다. 전화번호가 없는 대상은 선택할 수 없습니다.',
      '차시별 메시지는 차시를 고르고 대상과 기록 불러오기를 누릅니다. 이번 문자에 포함할 숙제와 시험을 고르면 ${HOMEWORK}, ${TEST} 변수에 선택한 항목의 이름과 학생별 결과가 들어갑니다. 미리보기를 확인한 뒤 대기 목록에 추가해 주세요.',
      '대기 목록에 추가하는 것만으로 문자가 전송되지는 않습니다. 허용된 Android 기기에서 대기 문자 발송을 눌러야 실제 발송을 시도합니다. 진행 상태와 실패 건수는 메시지 화면에서 확인할 수 있습니다.',
    ],
  },
  {
    title: '6. Android 문자 발송 기기 등록',
    paragraphs: [
      '문자를 보낼 Android 앱에서 해당 수업의 메시지 → 이 기기 등록 요청을 누릅니다. 매니저 또는 관리자가 조교 탭의 발송 기기 관리에서 기기를 허용합니다. 이후 메시지 화면에서 승인 상태 새로고침을 눌러 발송 허용을 확인합니다.',
      'SMS 권한이 회색으로 막힌 기기에서는 다음 순서로 제한된 설정을 허용해 주세요. ① 휴대전화 설정을 엽니다. ② 애플리케이션으로 이동합니다. ③ 이 앱을 선택합니다. ④ 오른쪽 위 더보기(⁝)를 누릅니다. ⑤ 제한된 설정 허용을 선택하고 본인 인증을 합니다. ⑥ 앱 정보의 권한에서 SMS를 허용합니다.',
      '기종이나 Android 버전에 따라 메뉴 이름과 위치가 다를 수 있습니다. 이 설정은 설치한 앱과 발송 기기를 본인이 확인한 경우에만 진행해 주세요.',
    ],
  },
  {
    title: '7. 문의와 문제 해결',
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
