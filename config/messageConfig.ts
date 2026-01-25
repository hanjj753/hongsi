//메시지 양식을 저장해두는 파일
// \${VARIABLE_NAME} 형태로 변수 삽입 가능
// \${STUDENT_NAME} => 학생 이름
// \${CLASS_NAME} => 수업 이름
// \${DAY} => 수업 요일
// \${QUARTER} => 학기
// \${SESSION} => 차시
// \${ATTENDANCE} => 출석 결과
// \${HOMEWORK} => 숙제 결과
// \${TEST} => 시험 결과
export const INDIVIDUAL_MESSAGE_TEMPLATE = 
`\${STUDENT_NAME} 학생 \${SESSION}차시 테스트 문자

- 출석: \${ATTENDANCE}
- 숙제: \${HOMEWORK}
- 시험: \${TEST}

특이사항이 있다면 연락 바랍니다.`;