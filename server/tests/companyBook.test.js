/**
 * 회사 장부 점검.
 *
 *   cd server && npm test
 *
 * 엑셀 칸·내역으로 계정을 고르는 규칙과, 자금팀 엑셀 모양을 그대로 흉내 낸 작은 엑셀을 읽는 과정을 본다. DB에 붙지 않는다.
 * (실제 엑셀은 고객·직원 이름이 있어 저장소에 넣지 않는다)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import { pickCompanyAccount, signedAmount, accountOf } from '../../shared/companyAccounts.js';
import { parseCompanyBookWorkbook } from '../utils/companyBookImport.js';

test('엑셀 칸 + 내역으로 계정 고르기', () => {
  assert.equal(pickCompanyAccount('월급,탁송보험가입포함', '2022~1월급여'), 'salary');
  assert.equal(pickCompanyAccount('월급,탁송보험가입포함', '탁송보험-이두식'), 'delivery');
  assert.equal(pickCompanyAccount('소득세+지방세,4대보험', '퇴직연금'), 'payroll');
  // "선물-대표님 비품/기타" 칸은 성격이 섞여 있다
  assert.equal(pickCompanyAccount('선물-대표님 비품/기타', '상표출원 심사비'), 'professional');
  assert.equal(pickCompanyAccount('선물-대표님 비품/기타', '사람인-구인광고'), 'marketing');
  assert.equal(pickCompanyAccount('선물-대표님 비품/기타', '황태 박스'), 'entertainment');
  assert.equal(pickCompanyAccount('선물-대표님 비품/기타', '서울시대여조합 가입비'), 'union');
  // 입찰 보증금은 비용이 아니다(2024년 5,500만 원이 비용으로 잡혔던 줄)
  assert.equal(pickCompanyAccount('기타 비용/은행수수료', '미군부대 입찰 수수료'), 'deposit');
  assert.equal(pickCompanyAccount('기타 비용/은행수수료', '대출5억 약정수수료'), 'loanFee');
  assert.equal(pickCompanyAccount('지 출(식대,비품및기타)', '직원 식대'), 'welfare');
  assert.equal(pickCompanyAccount('지 출(식대,비품및기타)', '주유비'), 'travel');
  assert.equal(pickCompanyAccount('지 출(식대,비품및기타)', '서초구청 증차공문'), 'admin');
  assert.equal(pickCompanyAccount('지 출(식대,비품및기타)', '복사지 구입'), 'supplies');
  assert.equal(pickCompanyAccount('법인세', '23년법인세  수수료'), 'professional');
  assert.equal(pickCompanyAccount('법인카드결제', '부산렉스카드'), 'card');
  assert.equal(pickCompanyAccount('처음 보는 칸', '아무 내역'), 'other');
});

test('장부 금액의 부호: 비용은 나간 돈이 +, 빌린 돈은 들어온 돈이 +', () => {
  assert.equal(signedAmount({ account: 'rent', direction: '출금', amount: 100 }), 100);
  assert.equal(signedAmount({ account: 'corpTax', direction: '입금', amount: 30 }), -30); // 법인세 환급
  assert.equal(signedAmount({ account: 'ownerLoan', direction: '입금', amount: 500 }), 500);
  assert.equal(signedAmount({ account: 'ownerLoan', direction: '출금', amount: 200 }), -200);
  assert.equal(accountOf('없는계정').key, 'other');
});

/** 자금팀 엑셀과 같은 모양의 작은 엑셀 */
const buildWorkbook = () => {
  const wb = XLSX.utils.book_new();
  const blank = (n) => Array.from({ length: n }, () => '');
  // 비용 시트: 1행 칸 제목, 4행 계, 6행 내역/금액/날짜, 7행부터 데이터
  const expense = [
    ['월급,탁송보험가입포함', '', '', '법인세', '', ''],
    blank(6), blank(6),
    ['', '계', 0, '', '계', 0],
    blank(6),
    ['내역', '금액', '날짜', '내역', '금액', '날짜'],
    ['2025-1월 급여', 3000000, 45672, '법인세 중간예납', 71270, 45700],
    ['2025-2월 급여', 3000000, '2025-02-25', '24년 법인세 환급', -2048340, 45757],
    ['주차비', 55300, '2022-02-29', '', '', ''], // 없는 날짜
    ['다솔 월 기장료', '', '', '-', '-', '-'] // 아직 안 나간 달 자리, "-" 자리 표시
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(expense), '고정비용');
  const owner = [
    ['대표님 차입금'], blank(9), blank(9), blank(9), blank(9),
    ['지출-상환', '', '', '', '입금'],
    ['', '적 요', '금액', '비고', '고객입금액', '적 요', '금액', '일 자', '상환 일자'],
    ['', '메인 통장', 500000000, 44565, '', '자본금', 300000000, 44482, ''],
    ['', '', '', '', '', 'SC 마통', 50000000, 44699, 44981]
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(owner), '대표 차입금');
  const vat = [
    ['부가세'], blank(9), blank(9), blank(9), blank(9),
    ['지출', '', '', '', '입금-환급'],
    ['', '', '금액', '비고', '', '', '금액', '비고'],
    ['', '법인세 중간 예납', 71270, 45702, '', '21년2기 부가세 환급', 208517190, 44607]
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(vat), '부가세');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
};

test('자금팀 엑셀 읽기', () => {
  const { rows, skipped } = parseCompanyBookWorkbook(buildWorkbook());
  const find = (desc) => rows.find((r) => r.description === desc);

  assert.equal(find('2025-1월 급여').account, 'salary');
  assert.equal(find('2025-1월 급여').direction, '출금');
  assert.equal(find('2025-2월 급여').date.toISOString().slice(0, 10), '2025-02-25');
  assert.equal(find('24년 법인세 환급').direction, '입금');
  assert.equal(find('24년 법인세 환급').amount, 2048340);

  // 2022-02-29처럼 없는 날짜는 넣지 않고 알려 준다. 빈 자리·"-" 줄은 조용히 넘긴다
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].reason, /날짜/);

  // 대표 차입금: 자본금은 빌린 돈이 아니다
  assert.equal(find('자본금').account, 'capital');
  assert.equal(find('메인 통장').direction, '출금');
  assert.equal(find('SC 마통').direction, '입금');
  assert.match(find('SC 마통').memo, /상환 2023-02-24/);

  // 부가세 시트의 법인세 줄은 고정비용 쪽과 같은 줄이라 합계에서 뺀다. 부가세 환급은 그대로
  assert.equal(find('법인세 중간 예납').excluded, true);
  assert.equal(find('21년2기 부가세 환급').account, 'vat');
  assert.ok(!find('21년2기 부가세 환급').excluded);

  // 다시 올려도 같은 줄을 알아보는 열쇠는 겹치지 않는다
  assert.equal(new Set(rows.map((r) => r.importKey)).size, rows.length);
});
