// 렌트출고 보고 글 양식(대표님 2026-11-12). 칸 이름과 순서가 곧 양식이다.

export const RELEASE_FIELDS = [
  { group: '계약사·담당자', items: [['party', '계약사'], ['managerMain', '책임 담당자'], ['managerOps', '실무 담당자']] },
  { group: '차량', items: [['carModel', '차종'], ['year', '연식'], ['color', '색상 (외장/내장)'], ['vin', '차대번호'], ['plateNo', '차량번호']] },
  { group: '날짜·출고지', items: [['contractDate', '계약일', 'date'], ['registrationDate', '등록일', 'date'], ['deliveryDate', '인도일', 'date'], ['endDate', '종료일', 'date'], ['place', '출고지']] },
  { group: '금액·구입방법', items: [['carPrice', '차량가'], ['term', '기간'], ['deposit', '보증금'], ['advancePayment', '선수금'], ['takeoverPrice', '인수가'], ['monthlyFee', '렌트료']] },
  { group: '용품', items: [['tinting', '썬팅'], ['blackbox', '블랙박스'], ['tire', '타이어']] },
  { group: '보험', items: [['insurance', '보험 (한 줄)', 'textarea']] },
  { group: '정비', items: [['emergency', '긴급출동'], ['accidentRepair', '사고수리'], ['generalMaintenance', '일반정비'], ['consumables', '소모품교환'], ['tireCount', '타이어 본수']] },
  { group: '기타', items: [['extra', '기타작업 (예: 유리막 / PPF / 장우산 1개)']] }
];

const v = (x) => String(x ?? '').trim();

/** 종료일 = 인도일 + 기간(개월) − 1일. 인도 2026-11-12, 60개월이면 2031-11-11. */
export const releaseEndDate = (deliveryYmd, termMonths) => {
  const m = Number(termMonths);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(deliveryYmd || '')) || !(m > 0)) return '';
  const [y, mo, d] = deliveryYmd.split('-').map(Number);
  const end = new Date(Date.UTC(y, mo - 1 + m, d) - 24 * 3600e3);
  return end.toISOString().slice(0, 10);
};

/** 칸 값으로 보고 글을 만든다. 비어 있는 칸도 줄은 남긴다(양식 그대로). */
export const releaseReportText = (f = {}) => [
  '렌트출고-------------------------------------------------------------------------------',
  '**렌트베네핏',
  `계약사 : ${v(f.party)}`,
  `-책임 담당자 : ${v(f.managerMain)}`,
  `-실무 담당자 : ${v(f.managerOps)}`,
  `-차종/연식 : ${[v(f.carModel), v(f.year)].filter(Boolean).join('/')}`,
  `-색상 : ${v(f.color)}`,
  `1) 계약일 : ${v(f.contractDate)}`,
  `2) 등록일 : ${v(f.registrationDate)}`,
  `3) 인도일 : ${v(f.deliveryDate)}`,
  `4) 종료일 : ${v(f.endDate)}`,
  `5) 출고지 : ${v(f.place)}`,
  `6) 차대 번호 / 차량번호 : ${v(f.vin)} / ${v(f.plateNo)}`,
  `7) 차량가 : ${v(f.carPrice)}`,
  '8) 구입방법',
  `    -기간 : ${v(f.term)}`,
  `    -보증금 : ${v(f.deposit)}`,
  `    -선수금 : ${v(f.advancePayment)}`,
  `    -인수가 : ${v(f.takeoverPrice)}`,
  `    -렌트료 : ${v(f.monthlyFee)}`,
  `9) 썬팅 : ${v(f.tinting)}`,
  `10) 블랙박스 : ${v(f.blackbox)}`,
  `11) 타이어 : ${v(f.tire)}`,
  `12) 보험 : ${v(f.insurance)}`,
  '13) 정비',
  `    -긴급출동 : ${v(f.emergency)}`,
  `    -사고수리 : ${v(f.accidentRepair)}`,
  `    -일반정비 : ${v(f.generalMaintenance)}`,
  `    -소모품교환 : ${v(f.consumables)}`,
  `    -타이어 본수 : ${v(f.tireCount)}`,
  `14) 기타작업 : ${v(f.extra)}`
].map((line) => line.replace(/\s+$/, '')).join('\n');
