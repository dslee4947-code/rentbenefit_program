import { test } from 'node:test';
import assert from 'node:assert/strict';
import { earlyPenalty, originOf, settlementOf } from '../../client/src/utils/contractEnd.js';
import { rentReceivedOf } from '../utils/rentReceived.js';

// 엑셀 '중도해지_정산서261104.xlsx' 입력값 시트의 예시(Carnival-006 더데이랩스)
const DOC = {
  monthlyFee: 643000,
  deposit: 0,
  advancePayment: 7884000,
  termMonths: 48,
  earlyRate: '35%',
  mileage: 30000,
  carModel: '카니발',
  deliveryDate: '2025-07-15',
  endDate: '2029-07-14'
};
const FORM = { returnDate: '2026-09-18', paidRent: 643000 * 12, actualKm: 30000, baseKm: 200, repairs: [0, 0, 0, 0, 0], toll: 0, fine: 300000, unpaidRepair: 0 };

test('엑셀 예시와 칸마다 같은 값이 나온다', () => {
  const s = settlementOf(DOC, FORM);
  assert.equal(s.usedDays, 431); // 정산서상세 D10
  assert.equal(s.remainDays, 1030); // F10
  assert.equal(s.totalDays, 1461); // F29
  assert.equal(s.advanceRemain, 5558193); // F32
  assert.equal(s.advanceUsed, 2325807); // F31
  assert.equal(s.usedMonths, 14);
  assert.equal(s.monthsRent, 9002000);
  assert.equal(s.leftFrom, '2026-09-15'); // E52
  assert.equal(s.leftDays, 4); // F52
  assert.equal(s.dailyRent, 21139); // F53
  assert.equal(s.leftRent, 84556); // F54
  assert.equal(s.dueRent, 9086556);
  assert.equal(s.unpaidRent, 1370556); // F55
  assert.equal(s.overpaidRent, 0);
  assert.equal(Math.round(s.contractKm), 35425); // F59
  assert.equal(s.excessFee, 0); // F64
  assert.equal(s.unpaidClaim, 300000); // F79
  assert.equal(s.penaltyDaily, 26530); // F83
  assert.equal(s.penalty, 8694604); // F87
  assert.equal(s.claimTotal, 10365160); // F19
  assert.equal(s.final, 4806967); // F22
  assert.equal(s.advanceMonthly, 164250);
});

test('약정을 넘겨 달리면 초과운행 부담금이 붙고, 외산은 km당 200원이다', () => {
  const domestic = settlementOf(DOC, { ...FORM, actualKm: 40000 });
  assert.equal(domestic.kmRate, 100);
  assert.equal(domestic.excessFee, Math.floor((40000 - (30000 / 365) * 431 - 200) * 100));
  const imported = settlementOf(DOC, { ...FORM, actualKm: 40000, origin: '외산' });
  assert.equal(imported.kmRate, 200);
  assert.equal(imported.final - domestic.final, imported.excessFee - domestic.excessFee);
});

test('수리내역·통행료·미납 수리비가 합계에 들어가고, 쉼표가 있는 입력도 읽는다', () => {
  const s = settlementOf(DOC, { ...FORM, repairs: ['100,000', '50000', '', '', ''], toll: '12,300', unpaidRepair: 7000 });
  assert.equal(s.repairTotal, 150000);
  assert.equal(s.unpaidClaim, 319300);
  assert.equal(s.final, 4806967 + 150000 + 12300 + 7000);
});

test('보증금은 최종 정산금에서 뺀다. 빼고 남으면 환급이라 음수다', () => {
  const s = settlementOf({ ...DOC, deposit: 20000000 }, FORM);
  assert.equal(s.final, 4806967 - 20000000);
});

test('반납일까지의 렌트료보다 더 냈으면 초과분을 위약금 등과 상계한다', () => {
  const s = settlementOf(DOC, { ...FORM, paidRent: 643000 * 15 });
  assert.equal(s.unpaidRent, 0);
  assert.equal(s.overpaidRent, 558444);
  assert.equal(s.claimTotal, 8994604);
  assert.equal(s.final, 8994604 - 5558193 - 558444);
});

test('1회차를 일할로 받은 계약도 실제 납부액으로 같은 식이다', () => {
  const full = settlementOf(DOC, FORM);
  const prorated = settlementOf(DOC, { ...FORM, paidRent: 643000 * 12 - 250000 });
  assert.equal(prorated.dueRent, full.dueRent);
  assert.equal(prorated.unpaidRent, full.unpaidRent + 250000);
  assert.equal(prorated.penalty, full.penalty);
});

test('말일 인도는 엑셀 EDATE처럼 그 달 말일로 맞춘다', () => {
  const s = settlementOf({ ...DOC, deliveryDate: '2025-01-31', endDate: '2029-01-30' }, { ...FORM, returnDate: '2025-03-10', paidRent: 643000 });
  assert.equal(s.usedMonths, 1);
  assert.equal(s.leftFrom, '2025-02-28');
  assert.equal(s.leftDays, 11);
  assert.equal(s.unpaidRent, 21139 * 11);
});

const rentRow = (round, amount, extra = {}) => ({ side: '입금', category: '렌트료', round, amount, ...extra });
const ROUNDS = [1, 2, 3].map((no) => ({ no, monthlyRent: 643000, status: '입금완료' }));

test('원장: 자동이체 수수료만큼 적은 줄은 다 낸 것으로, 과태료가 섞인 줄은 렌트료까지만 센다', () => {
  const r = rentReceivedOf({ entries: [rentRow(1, 642725), rentRow(2, 679325), rentRow(3, 643000)], rounds: ROUNDS });
  assert.equal(r.total, 643000 * 3);
  assert.equal(r.count, 3);
  assert.deepEqual(r.short, []);
});

test('원장: 정말 적게 낸 회차는 입금액만 인정하고 알려 준다', () => {
  const r = rentReceivedOf({ entries: [rentRow(1, 300000), rentRow(2, 643000), rentRow(3, 643000)], rounds: ROUNDS });
  assert.equal(r.total, 300000 + 643000 * 2);
  assert.deepEqual(r.short, [{ no: 1, amount: 300000, rent: 643000 }]);
});

test('원장: 1회차 일할은 그 회차 렌트료로 본다', () => {
  const rounds = [{ no: 1, monthlyRent: 321880, status: '입금완료' }, { no: 2, monthlyRent: 376700, status: '입금완료' }];
  const r = rentReceivedOf({ entries: [rentRow(1, 321605), rentRow(2, 376425)], rounds });
  assert.equal(r.total, 321880 + 376700);
});

test('원장: 다른 구간·지출·다른 분류 줄은 세지 않고, 빠진 회차와 번호 없는 줄을 알려 준다', () => {
  const r = rentReceivedOf({
    entries: [
      rentRow(1, 643000, { periodSeq: 2 }),
      rentRow(1, 111000, { periodSeq: 1 }),
      rentRow(2, 643000, { periodSeq: 2, side: '지출' }),
      { side: '입금', category: '렌트료', amount: 5000, periodSeq: 2 },
      { side: '입금', category: '과태료·통행료', round: 2, amount: 9000, periodSeq: 2 }
    ],
    rounds: ROUNDS,
    periodSeq: 2
  });
  assert.equal(r.total, 643000);
  assert.deepEqual(r.missing, [2, 3]);
  assert.equal(r.unnumbered, 1);
});

test('원장: 이 구간에 받은 선수금을 함께 센다', () => {
  const r = rentReceivedOf({
    entries: [
      { side: '입금', category: '선납금', amount: 7884000, periodSeq: 1 },
      { side: '입금', category: '선납금', amount: 1000000, periodSeq: 2 },
      { side: '지출', category: '선납금', amount: 500, periodSeq: 1 }
    ],
    rounds: ROUNDS
  });
  assert.equal(r.advanceIn, 7884000);
});

test('원장: 여러 대 계약은 적힌 금액을 그대로 합친다', () => {
  const r = rentReceivedOf({ entries: [rentRow(1, 366700), rentRow(2, 367200)], rounds: ROUNDS, share: 0.49, multi: true });
  assert.equal(r.total, 366700 + 367200);
  assert.deepEqual(r.short, []);
  assert.equal(r.lastAmount, 367200);
});

test('날짜가 없으면 계산하지 않는다', () => {
  assert.equal(settlementOf(DOC, { ...FORM, returnDate: '' }), null);
  assert.equal(settlementOf({ ...DOC, deliveryDate: '' }, FORM), null);
});

test('선수금이 없으면 위약금 1일 대여료는 월 대여료 몫만이다', () => {
  const p = earlyPenalty({ monthlyFee: 643000, endDate: '2029-07-14', terminateDate: '2026-09-18', ratePct: 35 });
  assert.equal(p.daily, 21130);
});

test('차종 이름으로 국산·외산을 나눈다', () => {
  for (const m of ['Ray Van 스탠다드 A/T', 'K8 노블레스 2.5', 'K5(H) 하이브리드', 'G80 2.5T AWD', 'GV70 2.5T', '그랜저(H) 1.6T', 'Grand Koleos E-Tech', '아이오닉6 2WD', 'Cona SX2 런칭', 'Mojave 더 마스터', '더 뉴 레이 가솔린 프레스티지', '펠리세이드(H) 2.5T']) {
    assert.equal(originOf(m), '국산', m);
  }
  for (const m of ['G63 Edition', 'E350 4Matic AV', 'S580 4Matic L', 'RX 350h Luxury', 'ALPHARD-HEV SFX', 'GLE450 4M', 'MAYBACH S580 4Matic L']) {
    assert.equal(originOf(m), '외산', m);
  }
});
