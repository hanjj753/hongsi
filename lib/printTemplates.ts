export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character] ?? character));
}

export type PrintableQuestionRow = {
  studentName: string;
  studentCode: string;
  entered: boolean;
  wrongNumbers: number[];
};

export function buildQuestionSheetHtml(input: {
  title: string;
  date: string;
  testTitle: string;
  objectiveCount: number;
  essayCount: number;
  rows: PrintableQuestionRow[];
}): string {
  const total = input.objectiveCount + input.essayCount;
  const questionChunks = Array.from({ length: Math.ceil(total / 28) }, (_, page) =>
    Array.from({ length: Math.min(28, total - page * 28) }, (_, i) => page * 28 + i + 1));
  const studentChunks = Array.from({ length: Math.max(1, Math.ceil(input.rows.length / 26)) }, (_, page) =>
    input.rows.slice(page * 26, page * 26 + 26));
  const label = (number: number) => number <= input.objectiveCount
    ? String(number) : `서${number - input.objectiveCount}`;
  const pages = studentChunks.flatMap((students, studentPage) => questionChunks.map((questions, questionPage) => {
    const head = questions.map((number) => `<th>${label(number)}</th>`).join('');
    const body = students.map((student) => {
      const wrongs = new Set(student.wrongNumbers);
      const cells = questions.map((number) => `<td class="${wrongs.has(number) ? 'wrong' : ''}">${wrongs.has(number) ? 'X' : ''}</td>`).join('');
      const shownWrongCount = questions.filter((number) => wrongs.has(number)).length;
      return `<tr><th class="student">${escapeHtml(student.studentName)}</th>${cells}<td class="total">${student.entered ? shownWrongCount : '—'}</td></tr>`;
    }).join('');
    const sums = questions.map((number) => `<td>${students.filter((student) => student.entered && student.wrongNumbers.includes(number)).length}</td>`).join('');
    const grand = students.reduce((sum, student) => sum + (student.entered ? questions.filter((number) => student.wrongNumbers.includes(number)).length : 0), 0);
    return `<section class="page">
      <h1>${escapeHtml(input.title)} · ${escapeHtml(input.testTitle)} 오답표</h1>
      <p>${escapeHtml(input.date)} · 객관식 ${input.objectiveCount}문항 · 서술형 ${input.essayCount}문항${questionChunks.length * studentChunks.length > 1 ? ` · ${studentPage + 1}/${studentChunks.length} 학생 묶음, ${questionPage + 1}/${questionChunks.length} 문항 묶음` : ''}</p>
      <table><thead><tr><th class="student">이름</th>${head}<th class="total">${questionChunks.length > 1 ? "표시 문항 오답수" : "오답수"}</th></tr></thead>
      <tbody>${body || `<tr><td colspan="${questions.length + 2}">학생이 없습니다.</td></tr>`}</tbody>
      <tfoot><tr><th class="student">오답수</th>${sums}<td class="total">${grand}</td></tr></tfoot></table>
      <p class="footnote">X = 오답 · 빈칸 = 정답 또는 미입력 · 오른쪽 — = 학생별 미입력</p>
    </section>`;
  })).join('');
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(input.testTitle)} 오답표</title>
    <style>@page{size:A4 landscape;margin:10mm}*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}body{font-family:Arial,'Malgun Gothic',sans-serif;color:#111827;margin:0}
    .page{page-break-after:always}.page:last-child{page-break-after:auto}h1{font-size:19px;margin:0 0 5px}p{font-size:11px;margin:0 0 10px;color:#475569}
    table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{border:1px solid #4B5563;height:24px;text-align:center;font-size:10px;padding:2px 0}
    th{background:#F1F5F9;font-weight:700}.student{width:27mm;text-align:left;padding-left:5px;white-space:nowrap;overflow:hidden}.total{width:15mm;background:#FEF3C7;font-weight:700}
    .wrong{background:#F9DADA;color:#991B1B;font-weight:800}tfoot th,tfoot td{background:#FEF3C7;font-weight:700}.footnote{margin-top:8px;font-size:9px}</style>
    </head><body>${pages}</body></html>`;
}
