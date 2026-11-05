import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseServiceDocument, pickServiceTarget, serviceDocTypeOf } from '../utils/serviceDocument.js';
import { parseRepairInvoice } from '../utils/repairInvoice.js';
import { readInvoiceText } from '../utils/repairInvoice.js';

// 실제 서류의 모양을 본떴다(차량번호·이름은 시험용). OCR이 칸마다 줄을 나눈 그대로 둔다.
const DIAGNOSIS = `[별지 제2호서식 ]
자동차 기능 종합 진단서
검사일자 : 2024 년 05 월 20 일
자동차등록번호
125호1111
차대번호
좀환 검사일
WINIPB5EB1NA702527
2025-05-18
재검사 기간
최초등록일
주행거리
2022년 05월 19일
72,019
km
부적합 내용
(재검사 대상)
강남 자동차검사소 02-459-2844
본 진단서는 고객님의 차량 관리를 위한 진단결과입니다`;

const RESULT = `접수번호: H630-20241113-0022-1
H630k38033 / 2024-11-13 11:46
자동차 정기검사 결과표
① 자동차등록번호
125호2222
⑧ 누적주행거리
승용차일반형대형
영업용
41,652
⑨ 최초등록일
2022-11-16
⑩ 종합판정
적합
⑪ 다음 검사주기
2024-11-16 ~ 2025-11-15
<부적합 내용>
검사대행자(지정정비사업자) (주)완주자동차정비사업소`;

const ESTIMATE = `■ 자동차관리법 시행규칙 [별지 제89호의3 서식]
자동차 점검· 정비견적서
등록번호
125호6021
주행거리
88,847 Km
사업자등록번호
765-81-00635
업체명 및 대표자
(주)시험모터스
견적구분
견적내용
부품내역
기술료
합계
코드
수량
단가
계
서비스 경고등 점등
A
스타 진단 테스트
A
30,000
30,000
30,000
엔진 오일 교환
A
9
23,000
207,000
60,000
267,000
뒤 브레이크 패드 교환
A
352,000
352,000
70,000
422,000
구분(보험 · 일반)
부 품
기술료
계
부가가치세
총액
일반
589,000
130,000
719,000
71,900
790,900
2026 년 11 월 04 일
안내사항
1. 견적요금은 교통사고 등의 처리를 목적으로 견적서를 발행한 경우에 청구가 가능합니다.`;

test('서류 종류를 가른다: 정비 양식 이름이 있으면 검사소 글자가 있어도 정비', () => {
  assert.equal(serviceDocTypeOf(DIAGNOSIS), 'inspection');
  assert.equal(serviceDocTypeOf(RESULT), 'inspection');
  assert.equal(serviceDocTypeOf(ESTIMATE), 'repair');
  assert.equal(serviceDocTypeOf('자동차점검 ·정비명세서 자동차검사소'), 'repair');
});

test('기능 종합 진단서: 검사일·다음 검사일·주행거리·검사소. 연도를 주행거리로 읽지 않는다', () => {
  const p = parseServiceDocument(DIAGNOSIS);
  assert.equal(p.kindGuess, '자동차검사');
  assert.equal(p.plateNo, '125호1111');
  assert.equal(p.date, '2024-05-20');
  assert.equal(p.nextDate, '2025-05-18');
  assert.equal(p.mileage, 72019);
  assert.equal(p.shop, '강남 자동차검사소');
  assert.equal(p.result, ''); // '부적합 내용' 제목을 판정으로 읽지 않는다
  assert.deepEqual(p.warnings, []);
});

test('정기검사 결과표: 머리 시각이 검사일, 검사주기 끝 날이 다음 검사일', () => {
  const p = parseServiceDocument(RESULT);
  assert.equal(p.date, '2024-11-13');
  assert.equal(p.nextDate, '2025-11-15');
  assert.equal(p.mileage, 41652);
  assert.equal(p.result, '적합');
  assert.equal(p.shop, '(주)완주자동차정비사업소');
});

test('부적합이면 알려 준다', () => {
  const p = parseServiceDocument(RESULT.replace('종합판정\n적합', '종합판정\n부적합'));
  assert.equal(p.result, '부적합');
  assert.ok(p.warnings.some((w) => w.includes('부적합')));
});

test('법정 견적서: 칸마다 나뉜 표를 줄로 묶고 합계 표를 읽는다', () => {
  const p = parseServiceDocument(ESTIMATE);
  assert.equal(p.docType, 'repair');
  assert.equal(p.plateNo, '125호6021');
  assert.equal(p.mileage, 88847);
  assert.equal(p.shop, '(주)시험모터스');
  assert.equal(p.date, '2026-11-04');
  assert.equal(p.kindGuess, '고장수리'); // 안내문의 '교통사고'로 사고수리가 되지 않는다
  assert.deepEqual(p.lines.map((l) => [l.name, l.qty, l.parts, l.labor, l.amount]), [
    ['서비스 경고등 점등', 1, 0, 0, 0],
    ['스타 진단 테스트', 1, 30000, 0, 30000],
    ['엔진 오일 교환', 9, 207000, 60000, 267000],
    ['뒤 브레이크 패드 교환', 1, 352000, 70000, 422000]
  ]);
  assert.equal(p.partsTotal, 589000);
  assert.equal(p.laborTotal, 130000);
  assert.equal(p.supply, 719000);
  assert.equal(p.vat, 71900);
  assert.equal(p.total, 790900);
  assert.equal(p.amount, 790900);
});

test('합계 표의 값이 서로 안 맞으면 믿지 않는다', () => {
  const p = parseRepairInvoice(ESTIMATE.replace('790,900', '999,999'));
  assert.notEqual(p.total, 999999);
});

const rec = (id, kind, date, status, extra = {}) => ({ _id: id, kind, date: `${date}T03:00:00.000Z`, status, ...extra });

test('넣을 일정: 안 끝난 일정 중 가장 가까운 것', () => {
  const list = [rec('a', '자동차검사', '2026-11-20', '예정'), rec('b', '자동차검사', '2026-12-30', '예정'), rec('c', '정기점검', '2026-11-18', '예정')];
  assert.equal(pickServiceTarget(list, { kind: '자동차검사', date: '2026-11-18' })._id, 'a');
});

test('넣을 일정: 정비 서류는 정비 쪽 일정이면 종류가 달라도 잡고, 검사 일정은 잡지 않는다', () => {
  const list = [rec('i', '자동차검사', '2026-11-18', '예정'), rec('m', '정기점검', '2026-11-20', '예정')];
  assert.equal(pickServiceTarget(list, { kind: '고장수리', date: '2026-11-18' })._id, 'm');
});

test('넣을 일정: 파일 없는 완료 기록은 며칠 안일 때만, 파일 있으면 새 기록', () => {
  const near = [rec('n', '자동차검사', '2024-11-13', '완료')];
  assert.equal(pickServiceTarget(near, { kind: '자동차검사', date: '2024-11-14' })._id, 'n');
  assert.equal(pickServiceTarget(near, { kind: '자동차검사', date: '2024-11-20' }), null);
  const filed = [rec('f', '자동차검사', '2024-11-13', '완료', { attachments: [{ savedPath: 'x' }] })];
  assert.equal(pickServiceTarget(filed, { kind: '자동차검사', date: '2024-11-13' }), null);
});

test('스캔 PDF의 쪽 표시만 있는 글자층은 글자로 보지 않고 OCR로 넘긴다', async () => {
  // 글자층 판단만 본다. OCR 설정이 없는 환경에서는 오류가 나고, 빈 글자를 그대로 돌려주면 안 된다
  const before = { url: process.env.CLOVA_OCR_INVOKE_URL, secret: process.env.CLOVA_OCR_SECRET };
  delete process.env.CLOVA_OCR_INVOKE_URL;
  delete process.env.CLOVA_OCR_SECRET;
  await assert.rejects(() => readInvoiceText(Buffer.from('x'), 'image/jpeg', 'a.jpg'), /OCR/);
  if (before.url) process.env.CLOVA_OCR_INVOKE_URL = before.url;
  if (before.secret) process.env.CLOVA_OCR_SECRET = before.secret;
});
