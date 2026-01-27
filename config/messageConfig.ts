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
`오늘 \${CLASS_NAME} \${SESSION}차시 수업을 진행하였습니다.
\${STUDENT_NAME} 학생 과제 및 테스트 결과 보내드립니다.

◇ 오늘 진도 : 
◇ 다음 진도 : 
◇ \${SESSION}차시 과제 완성도: \${HOMEWORK}
◇ \${SESSION}차시 테스트: \${TEST}점/점(평균: 점, 최고점: 점)

언제나 최선을 다하여 학생을 지도하겠습니다. 믿고 맡겨주셔서 감사합니다.`;