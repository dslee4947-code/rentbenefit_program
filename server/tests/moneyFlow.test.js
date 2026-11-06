/**
 * 돈 흐름도 계산 점검. DB에 붙지 않는다.
 *
 *   cd server && npm test
 *
 * 렌트와 판매를 나누고, 차값은 감가로, 이자는 회사 장부와 할부 이자만 들어가는지 본다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMoneyFlow, loanInterestShare, DEPRECIATION_COST } from '../utils/moneyFlow.js';

const NOW = new Date('2026-06-15T03:00:00Z');
const d = (s) => new Date(`${s}T00:00:00Z`);
const row = (side, category, amount, date, label = category) => ({ side, category, amount, date: date ? d(date) : undefined, label });
const period = (flow, key) => flow.periods.find((p) => p.key === key);
const costOf = (p, name) => (p.costs.find(([n]) => n === name) || [null, 0])[1];
const incomeOf = (p, name) => (p.income.find(([n]) => n === name) || [null, 0])[1];

const soldCar = {
  ledgerNo: 'Car-001',
  ledgerType: '장기렌트',
  status: '거래완료',
  header: { registeredAt: d('2025-01-01') },
  entries: [
    row('지출', '차량가', 60000000, '2025-01-01'),
    row('입금', '렌트료', 1000000, '2025-02-01'),
    row('입금', '계약금', 5000000, '2026-02-20', '판매 계약금'),
    row('입금', '차량가', 40000000, '2026-03-01', '차량대금')
  ]
};

test('차량대금 입금을 판매 매출로 잡고, 판 날까지 감가한 값을 원가로 뺀다', () => {
  const flow = buildMoneyFlow({ ledgers: [soldCar], txs: [], now: NOW });
  const y26 = period(flow, '2026');
  assert.equal(y26.saleRevenue, 45000000);
  assert.equal(y26.saleCount, 1);
  // 60개월에 차값의 80%: 월 80만 원. 2025-01-01 ~ 2026-03-01 = 14개월
  assert.equal(y26.saleCost, 60000000 - 800000 * 14);
  assert.equal(y26.sale, 45000000);
  // 판매 뒤로는 감가하지 않는다
  assert.equal(costOf(period(flow, '2025'), DEPRECIATION_COST), 800000 * 11);
  assert.equal(costOf(y26, DEPRECIATION_COST), 800000 * 3);
  // 판매 대금은 렌트 매출에 섞이지 않는다
  assert.equal(incomeOf(period(flow, '2025'), '장기 렌트료'), 1000000);
  assert.equal(y26.income.length, 0);
});

test('갑지의 날짜 없는 이자 줄은 넣지 않고, 회사 장부 이자만 잡는다', () => {
  const car = {
    ledgerNo: 'Car-002', ledgerType: '장기렌트', status: '운용중', header: { registeredAt: d('2026-01-01') },
    entries: [
      row('지출', '차량가', 30000000, '2026-01-01'),
      row('입금', '렌트료', 1000000, '2026-02-01'),
      row('지출', '할부이자', 9000000, null, '이자')
    ]
  };
  const flow = buildMoneyFlow({ ledgers: [car], txs: [{ date: d('2026-02-01'), direction: '출금', amount: 500000, account: 'interest' }], now: NOW });
  const y = period(flow, '2026');
  assert.equal(y.bookInterest, 500000);
  assert.equal(y.capitalInterest, 0);
  assert.equal(y.interest, 500000);
});

test('할부 상환은 이자 몫만 비용이고 원금은 비용이 아니다', () => {
  const car = {
    ledgerNo: 'Car-003', ledgerType: '장기렌트', status: '운용중', header: { registeredAt: d('2026-01-01') },
    entries: [
      row('지출', '차량가', 12000000, '2026-01-01'),
      row('입금', '렌트료', 1000000, '2026-02-01'),
      row('입금', '대출금', 10000000, '2026-01-01', '메리츠 입금'),
      row('지출', '할부금', 11000000, '2026-03-01', '메리츠 상환')
    ]
  };
  const y = period(buildMoneyFlow({ ledgers: [car], txs: [], now: NOW }), '2026');
  assert.equal(y.capitalInterest, 1000000);
  assert.equal(y.loanRepay, 10000000);
  assert.equal(y.interest, 1000000);
});

test('할부 원금을 모르면 이자를 지어내지 않고 확인 목록에 올린다', () => {
  const car = {
    ledgerNo: 'Car-004', ledgerType: '장기렌트', status: '운용중', header: { registeredAt: d('2026-01-01') },
    entries: [row('지출', '차량가', 12000000, '2026-01-01'), row('입금', '렌트료', 1000000, '2026-02-01'), row('지출', '할부금', 500000, '2026-03-01')]
  };
  const flow = buildMoneyFlow({ ledgers: [car], txs: [], now: NOW });
  assert.deepEqual(flow.checks.loanInterestUnknown, ['Car-004']);
  assert.equal(period(flow, '2026').capitalInterest, 0);
  assert.equal(period(flow, '2026').loanRepay, 500000);
});

test('이자 몫 비율: 끝난 대출, 진행 중 대출, 모르는 대출', () => {
  assert.equal(loanInterestShare({ paid: 110, principal: 100 }), 10 / 110);
  assert.equal(loanInterestShare({ paid: 30, principal: 100, monthly: 10, term: 12 }), 20 / 120);
  assert.equal(loanInterestShare({ paid: 30, principal: 100 }), null);
  assert.equal(loanInterestShare({ paid: 30, principal: 0 }), null);
});

test('끝난 차에 남은 보증금은 판매 매출에 더하되 현금 판매 대금에는 넣지 않는다', () => {
  const car = {
    ledgerNo: 'Car-005', ledgerType: '장기렌트', status: '거래완료', header: { registeredAt: d('2026-01-01') },
    entries: [
      row('지출', '차량가', 10000000, '2026-01-01'),
      row('입금', '렌트료', 500000, '2026-02-01'),
      row('입금', '보증금', 3000000, '2026-01-01'),
      row('입금', '렌트료', 500000, '2026-04-01')
    ]
  };
  const y = period(buildMoneyFlow({ ledgers: [car], txs: [], now: NOW }), '2026');
  assert.equal(y.saleRevenue, 3000000);
  assert.equal(y.sale, 0);
});

test('차량 판매 수수료는 이름에 판매가 있어도 판매 대금이 아니다', () => {
  const car = {
    ledgerNo: 'Car-006', ledgerType: '장기렌트', status: '운용중', header: { registeredAt: d('2026-01-01') },
    entries: [row('지출', '차량가', 10000000, '2026-01-01'), row('입금', '수수료', 700000, '2026-02-01', '차량 판매 수수료')]
  };
  const y = period(buildMoneyFlow({ ledgers: [car], txs: [], now: NOW }), '2026');
  assert.equal(y.sale, 0);
  assert.equal(incomeOf(y, '판매수수료·캐시백'), 700000);
});

test('번호가 비슷한 갑지(Ray-054, Ray-054_1)는 별개의 차로 센다', () => {
  const sold = { ...soldCar, ledgerNo: 'Ray-054_1' };
  const running = {
    ledgerNo: 'Ray-054', ledgerType: '장기렌트', status: '운용중', header: { registeredAt: d('2026-01-01') },
    entries: [row('지출', '차량가', 12000000, '2026-01-01'), row('입금', '렌트료', 300000, '2026-02-01')]
  };
  const flow = buildMoneyFlow({ ledgers: [sold, running], txs: [], now: NOW });
  assert.equal(period(flow, '2026').saleCount, 1);
  assert.deepEqual(flow.checks.saleOnRunningCar, []);
  // 운용 차는 판매와 무관하게 계속 감가: 5개월 × 월 16만 원, 판 차는 3개월 × 월 80만 원
  assert.equal(costOf(period(flow, '2026'), DEPRECIATION_COST), 160000 * 5 + 800000 * 3);
});

test('차가 아직 없는 계약의 계약금과 그 환급은 받아 둔 돈이 오간 것이다', () => {
  const car = {
    ledgerNo: 'Tesla-X', ledgerType: '장기렌트', status: '차량미배정',
    entries: [row('입금', '렌트료', 100000, '2026-01-01'), row('입금', '계약금', 5000000, '2026-02-01'), row('입금', '환급', -5000000, '2026-03-01', '계약금 환급')]
  };
  const y = period(buildMoneyFlow({ ledgers: [car], txs: [], now: NOW }), '2026');
  assert.equal(y.sale, 0);
  assert.equal(y.refund, 0);
  assert.equal(y.funding.length, 0);
});


test('감가·선납금 나눔은 현금 기준 값에 들어가지 않는다', () => {
  const car = {
    ledgerNo: 'Car-007', ledgerType: '장기렌트', status: '운용중', header: { registeredAt: d('2026-01-01') },
    terms: { termMonths: 10 },
    entries: [
      row('지출', '차량가', 10000000, '2026-01-01'),
      row('입금', '렌트료', 500000, '2026-02-01'),
      row('입금', '선납금', 1000000, '2026-01-01')
    ]
  };
  const y = period(buildMoneyFlow({ ledgers: [car], txs: [], now: NOW }), '2026');
  assert.equal(y.cashNet, 500000);
  assert.equal(incomeOf(y, '선납금 (나눠 반영)'), 600000); // 1~6월, 월 10만 원
});
