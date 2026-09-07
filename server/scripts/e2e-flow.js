/**
 * 업무 흐름 통합 점검 - 견적서부터 청구·입금까지 한 번에 돌려 본다.
 *
 * 화면을 하나하나 눌러 확인하면 한 바퀴에 30분이 걸리고, 그마저도 사람이 보는 것이라
 * "회차표가 안 만들어진 것"처럼 조용히 지나가는 문제를 놓친다.
 * 이 스크립트는 실제 서버 API를 순서대로 호출해, 각 단계에서 다음 단계가 쓸 값이
 * 제대로 만들어졌는지 확인한다. 흐름이 끊기는 지점을 바로 짚기 위한 것이다.
 *
 * 쓰는 법:
 *   1) 서버를 띄운다:            npm run dev --prefix server
 *   2) 점검을 돌린다:            node server/scripts/e2e-flow.js --yes
 *      청구서 발행까지 포함:      node server/scripts/e2e-flow.js --full
 *      만든 자료를 남겨 두려면:    node server/scripts/e2e-flow.js --keep
 *
 * 주의:
 * - 실제 DB에 자료를 만든다. 반드시 시험용 DB(MONGO_URI)를 보고 있는 서버에 돌린다.
 *   운영 DB에 돌리면 시험용 고객·계약이 목록에 섞인다(끝나면 지우지만, 중간에 멈추면 남는다).
 * - --full은 청구서 PDF 한 장을 계약자 폴더에 실제로 저장한다. 메일은 보내지 않는다.
 */

const BASE = process.env.E2E_BASE_URL || 'http://localhost:5000';
const ARGS = process.argv.slice(2);
const FULL = ARGS.includes('--full');
const KEEP = ARGS.includes('--keep');

// 이 값들로 만든 자료는 끝날 때 지운다. 중간에 멈춰 남았을 때 사람이 찾을 수 있게 표시를 붙인다.
const STAMP = Date.now().toString().slice(-8);
const TEST_NAME = `[점검]흐름테스트_${STAMP}`;

const results = [];
let failed = 0;

const check = (ok, label, detail = '') => {
  results.push({ ok, label, detail });
  if (!ok) failed += 1;
  const mark = ok ? '  통과' : '  실패';
  console.log(`${mark}  ${label}${detail ? `\n        ${detail}` : ''}`);
  return ok;
};

const step = (no, title) => console.log(`\n[${no}] ${title}`);

/** API 호출. 실패해도 던지지 않고 상태와 본문을 그대로 돌려준다(어디서 끊겼는지 봐야 한다). */
const api = async (method, path, body, extraHeaders = {}) => {
  const isForm = body instanceof FormData;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      // 쓰기 권한 확인용. 화면에서 로그인한 관리자와 같은 값이다.
      'x-user-role': 'admin',
      ...(isForm || body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...extraHeaders
    },
    body: isForm ? body : (body === undefined ? undefined : JSON.stringify(body))
  });
  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 300) }; }
  return { status: res.status, ok: res.ok, data };
};

const ymd = (d) => new Date(d).toISOString().slice(0, 10);

const created = { customerId: null, quoteId: null, draftContractId: null, contractId: null };

const cleanup = async () => {
  if (KEEP) {
    console.log('\n--keep 이라 만든 자료를 남겨 둡니다. 화면에서 직접 확인한 뒤 지워 주세요.');
    console.log(`  고객명: ${TEST_NAME}`);
    return;
  }
  console.log('\n[정리] 점검용 자료를 지웁니다.');
  // 계약을 지우면 묶인 차량과 회차표도 함께 지워진다(contractController.deleteContract).
  for (const id of [created.contractId, created.draftContractId]) {
    if (id) {
      const r = await api('DELETE', `/api/contracts/${id}`);
      console.log(`  계약 ${id}: ${r.ok ? '삭제' : `삭제 실패(${r.status})`}`);
    }
  }
  if (created.quoteId) {
    const r = await api('DELETE', `/api/quotes/${created.quoteId}`);
    console.log(`  견적 ${created.quoteId}: ${r.ok ? '삭제' : `삭제 실패(${r.status})`}`);
  }
  if (created.customerId) {
    const r = await api('DELETE', `/api/customers/${created.customerId}`);
    console.log(`  고객 ${created.customerId}: ${r.ok ? '삭제' : `삭제 실패(${r.status})`}`);
  }
};

const MONTHLY_FEE = 900000;
const TERM_MONTHS = 36;
const PAYMENT_DAY = '25';

const run = async () => {
  // 이 회사의 서버는 운영 DB(Atlas)를 보고 있다. 아무 생각 없이 돌려 운영 자료에
  // 점검용 계약이 섞이는 일을 막기 위해, 한 번 더 확인하게 한다.
  if (!ARGS.includes('--yes') && process.env.E2E_OK !== '1') {
    console.log('이 점검은 서버가 보고 있는 DB에 실제로 자료를 만듭니다.');
    console.log('시험용 DB를 보는 서버인지 확인한 뒤(server/.env의 MONGO_URI 끝 DB 이름),');
    console.log('다음처럼 다시 실행하세요:');
    console.log('  node server/scripts/e2e-flow.js --yes');
    process.exit(2);
  }

  console.log(`업무 흐름 점검 - ${BASE}`);
  console.log(`점검용 이름: ${TEST_NAME}${FULL ? ' (청구서 발행까지 포함)' : ' (청구서 발행 제외, --full로 포함)'}`);

  // ── 0. 서버가 살아 있는지
  step(0, '서버 연결');
  const ping = await api('GET', '/api/customers?limit=1');
  if (!check(ping.ok, '서버 응답', ping.ok ? '' : `${ping.status} - 서버를 먼저 띄우세요: npm run dev --prefix server`)) {
    return;
  }

  // ── 1. 고객
  step(1, '고객 등록');
  const cust = await api('POST', '/api/customers', {
    name: TEST_NAME,
    bizNo: `999-99-${STAMP.slice(-5)}`,
    ceoName: '홍길동',
    contactName: '홍길동',
    contactPhone: '010-0000-0000',
    email: 'e2e@example.com'
  });
  if (!check(cust.ok, '고객 생성', cust.ok ? `id=${cust.data._id}` : JSON.stringify(cust.data))) return;
  created.customerId = cust.data._id;

  // ── 2. 견적서
  step(2, '견적서 작성');
  const quote = await api('POST', '/api/quotes', {
    customer: created.customerId,
    customerName: TEST_NAME,
    partyType: '개인',
    vehicleModel: '점검용차량',
    vehicleSpec: '2.5 가솔린',
    vehicleDetail: { fuelType: '가솔린', cc: 2500, exteriorColor: '흰색', interiorColor: '검정' },
    totalPrice: 45000000,
    monthlyEstimates: [{ termMonths: TERM_MONTHS, monthlyFee: MONTHLY_FEE, contractType: '렌트' }],
    terms: { lateInterestRate: 25, earlyTerminationRate: 35 },
    pricing: {
      basePrice: 45000000,
      optionPrice: 0,
      discount: 0,
      deliveryFee: 0,
      monthlyFee: MONTHLY_FEE,
      paymentTerm: TERM_MONTHS,
      baseInterestRate: 0.06
    }
  });
  if (!check(quote.ok, '견적서 저장', quote.ok ? `id=${quote.data._id}` : JSON.stringify(quote.data))) return;
  created.quoteId = quote.data._id;
  check(quote.data.pricing?.monthlyFee === MONTHLY_FEE,
    '견적서에 가격 상세가 함께 저장됨 (계약서 등록에서 그대로 불러 쓰는 값)');
  check(quote.data.terms?.lateInterestRate === 25,
    '계약 조건(연체 이율)이 견적서에 저장됨');

  // ── 3. 계약서 등록 전환 (임시저장)
  step(3, '견적서 → 계약서 등록 전환 (임시저장 계약이 생기는지)');
  const draft = await api('POST', '/api/contracts/draft', {
    customerId: created.customerId,
    quoteId: created.quoteId,
    contractDate: ymd(new Date()),
    termMonths: TERM_MONTHS,
    partyType: '개인',
    pricing: quote.data.pricing,
    vehicleInfo: { model: '점검용차량' }
  });
  if (check(draft.ok, '임시저장 계약 생성', draft.ok ? `계약번호=${draft.data.contractNo}` : JSON.stringify(draft.data))) {
    created.draftContractId = draft.data._id;
    check(draft.data.status === '임시저장', '상태가 "임시저장"');
    check(String(draft.data.quote) === String(created.quoteId), '계약서에 견적서가 연결됨');
    const q2 = await api('GET', `/api/quotes/${created.quoteId}`);
    check(q2.data?.status === '계약전환', '견적서 상태가 "계약전환"으로 바뀜',
      q2.data?.status ? `현재 ${q2.data.status}` : '');
  }

  // ── 4. 계약서 최종 등록
  step(4, '계약서 등록 (차량 · 원장 · 회차표가 같이 만들어지는지)');
  const contract = await api('POST', '/api/contracts', {
    customerId: created.customerId,
    quoteId: created.quoteId,
    partyType: '개인',
    contractDate: ymd(new Date()),
    deliveryDate: ymd(new Date()),
    termMonths: TERM_MONTHS,
    managerMain: '점검담당',
    managerOps: '점검담당',
    terms: { lateInterestRate: 25, earlyTerminationRate: 35 },
    pricing: { ...quote.data.pricing, monthlyFee: MONTHLY_FEE, paymentTerm: TERM_MONTHS },
    vehicleInfo: {
      model: '점검용차량',
      spec: '2.5 가솔린',
      fuelType: '가솔린',
      cc: 2500,
      color: '흰색',
      vehiclePrice: 45000000
    }
  });
  if (!check(contract.ok, '계약서 등록', contract.ok ? '' : `${contract.status} ${JSON.stringify(contract.data)}`)) {
    await cleanup();
    return;
  }
  created.contractId = contract.data.contract?._id || contract.data._id;

  const full = await api('GET', `/api/contracts/${created.contractId}`);
  const contractDoc = full.data?.contract || full.data;
  check(Boolean(contractDoc?.contractNo), '계약번호 자동 채번', contractDoc?.contractNo || '');
  const vehicleId = contractDoc?.vehicle?._id || contractDoc?.vehicle;
  check(Boolean(vehicleId), '차량이 렌트차량 DB에 만들어짐');
  check(contractDoc?.terms?.lateInterestRate === 25, '견적서의 계약 조건이 계약서로 이관됨');

  // 회차표는 결제일·게시일이 있어야 만들어진다. 계약 등록만으로는 대개 아직 없다.
  const sched0 = await api('GET', `/api/billing-schedules/contract/${created.contractId}`);
  const hasScheduleNow = Boolean(sched0.data?.schedule || sched0.data?._id);
  console.log(`        참고: 계약 등록 직후 회차표 ${hasScheduleNow ? '있음' : '없음(출고 준비에서 만들어짐 - 정상)'}`);

  // 회차표가 없는 계약은 대시보드 경고에 잡혀야 한다. 이게 없으면 매출이 조용히 빠진다.
  if (!hasScheduleNow) {
    const gaps = await api('GET', '/api/dashboard/billing-gaps');
    const mine = (gaps.data?.items || []).find((it) => String(it._id) === String(created.contractId));
    check(Boolean(mine), '청구가 시작되지 않은 계약으로 대시보드에 잡힘',
      mine ? `사유: ${mine.reason}` : '대시보드 경고에 잡히지 않았습니다.');
  }

  if (!vehicleId) { await cleanup(); return; }

  // ── 5. 출고 준비
  step(5, '출고 준비 (인도일 · 게시일 · 결제일 입력 → 회차표 생성)');
  const rentStart = new Date();
  const veh = await api('PUT', `/api/vehicles/${vehicleId}`, {
    plateNo: `99가${STAMP.slice(-4)}`,
    vin: `E2E${STAMP}TEST0001`,
    year: '2026년식',
    deliveryDate: ymd(rentStart),
    rentBillingDate: ymd(rentStart),
    monthlyPaymentDay: PAYMENT_DAY,
    interestRate: 6,
    status: '장기렌트'
  });
  check(veh.ok, '차량 실물 정보 저장', veh.ok ? (veh.data.message || '') : JSON.stringify(veh.data));
  check(String(veh.data?.message || '').includes('회차'),
    '저장과 동시에 청구 회차표가 준비됨',
    veh.data?.message || '');

  // ── 6. 회차표
  step(6, '청구 회차표 확인');
  const s = await api('GET', `/api/billing-schedules/contract/${created.contractId}`);
  const schedule = s.data?.schedule || s.data;
  if (!check(Boolean(schedule?._id), '회차표 조회',
    schedule?._id ? '' : '회차표가 없습니다. 결제일·렌트료 게시일이 저장됐는지 확인하세요.')) {
    await cleanup();
    return;
  }
  const scheduleId = schedule._id;
  check(schedule.rounds?.length === TERM_MONTHS,
    `회차 수가 계약 기간과 같음 (${TERM_MONTHS}회)`, `실제 ${schedule.rounds?.length}회`);
  check(schedule.monthlyRent === MONTHLY_FEE,
    '월 렌트료가 계약의 월 대여료와 같음', `${schedule.monthlyRent}원`);
  const r1 = schedule.rounds?.[0];
  const r1Day = r1 ? new Date(r1.dueDate).getDate() : 0;
  check(r1Day === Number(PAYMENT_DAY),
    `1회차 출금일이 결제일(${PAYMENT_DAY}일)에 맞음`, r1 ? ymd(r1.dueDate) : '');
  check(r1?.total === MONTHLY_FEE, '1회차 청구액이 월 렌트료와 같음', `${r1?.total}원`);

  // 회차표가 생겼으니 대시보드 경고에서 빠져야 한다
  const gaps2 = await api('GET', '/api/dashboard/billing-gaps');
  const still = (gaps2.data?.items || []).some((it) => String(it._id) === String(created.contractId));
  check(!still, '회차표가 생기자 대시보드 경고에서 빠짐');

  // ── 7. 회차 금액 수정
  step(7, '회차에 기타 청구 붙이기 (합계가 다시 계산되는지)');
  const EXTRA = 55000;
  const upd = await api('PUT', `/api/billing-schedules/${scheduleId}/rounds/1`, {
    extras: [{ label: '통행료', amount: EXTRA }]
  });
  check(upd.ok, '기타 청구 저장', upd.ok ? '' : JSON.stringify(upd.data));
  check(upd.data?.round?.total === MONTHLY_FEE + EXTRA,
    '청구 합계 = 월 렌트료 + 기타 청구', `${upd.data?.round?.total}원`);
  check(upd.data?.round?.other === EXTRA, '기타 청구 합계가 항목별 금액과 맞음');

  // ── 8. 청구서 발행 (--full)
  if (FULL) {
    step(8, '청구서 발행 (파일 저장까지. 메일은 보내지 않음)');
    const form = new FormData();
    // 최소한의 PDF 한 장. 내용이 아니라 "저장 경로가 잡히는지"를 본다.
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
    form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'e2e.pdf');
    form.append('sendEmail', 'false');
    const issued = await api('POST', `/api/billing-schedules/${scheduleId}/rounds/1/issue`, form);
    check(issued.ok, '청구서 발행', issued.ok ? (issued.data.message || '') : JSON.stringify(issued.data));
    if (issued.data?.localPath) {
      console.log(`        저장 경로: ${issued.data.localPath}`);
      console.log('        (점검용 파일이니 확인 후 지워 주세요. 계약을 지워도 파일은 남습니다.)');
    }
    const afterIssue = await api('GET', `/api/billing-schedules/contract/${created.contractId}`);
    const ir1 = (afterIssue.data?.schedule || afterIssue.data)?.rounds?.[0];
    check(ir1?.status === '청구됨', '1회차 상태가 "청구됨"', `현재 ${ir1?.status}`);
    check(Boolean(ir1?.issuedAt), '발행 시각이 남음');
    check(!ir1?.sentAt, '메일을 보내지 않았으므로 발송 시각은 비어 있음');
  } else {
    step(8, '청구서 발행 - 건너뜀 (--full 로 포함)');
  }

  // ── 9. 입금 · 미납 이월
  step(9, '부분 입금 → 다음 회차로 미납·이자 이월');
  const total1 = MONTHLY_FEE + EXTRA;
  const SHORT = 100000; // 10만원 덜 들어온 상황
  const pay = await api('PATCH', `/api/billing-schedules/${scheduleId}/rounds/1/payment`, {
    paidAmount: total1 - SHORT
  });
  check(pay.ok, '입금액 입력', pay.ok ? (pay.data.message || '') : JSON.stringify(pay.data));
  check(pay.data?.round?.status === '미납', '덜 들어왔으므로 상태가 "미납"', `현재 ${pay.data?.round?.status}`);
  check(pay.data?.unpaid === SHORT, '남은 금액이 미납으로 잡힘', `${pay.data?.unpaid}원`);

  const s2 = await api('GET', `/api/billing-schedules/contract/${created.contractId}`);
  const r2 = (s2.data?.schedule || s2.data)?.rounds?.[1];
  check(r2?.prevUnpaid === SHORT, '2회차에 전월 미결제가 이월됨', `${r2?.prevUnpaid}원`);
  check((r2?.interest || 0) > 0, '2회차에 연체 이자가 계산됨',
    `${r2?.interest}원 (연 ${r2?.interestRate}%, ${r2?.interestDays}일)`);
  check(r2?.total === (r2?.monthlyRent || 0) + (r2?.prevUnpaid || 0) + (r2?.interest || 0),
    '2회차 합계 = 월 렌트료 + 전월 미결제 + 연체 이자', `${r2?.total}원`);

  // 전액 입금으로 되돌리면 이월도 사라져야 한다
  step(10, '전액 입금으로 정정 → 이월이 사라지는지');
  const pay2 = await api('PATCH', `/api/billing-schedules/${scheduleId}/rounds/1/payment`, {
    paidAmount: total1
  });
  check(pay2.data?.round?.status === '입금완료', '1회차가 "입금완료"로 바뀜');
  const s3 = await api('GET', `/api/billing-schedules/contract/${created.contractId}`);
  const r2b = (s3.data?.schedule || s3.data)?.rounds?.[1];
  check((r2b?.prevUnpaid || 0) === 0, '2회차의 전월 미결제가 0으로 되돌아감', `${r2b?.prevUnpaid}원`);
  check((r2b?.interest || 0) === 0, '2회차의 연체 이자도 사라짐', `${r2b?.interest}원`);
};

run()
  .catch((err) => {
    console.error(`\n점검 중 오류: ${err.message}`);
    failed += 1;
  })
  .finally(async () => {
    await cleanup();
    console.log(`\n${'='.repeat(60)}`);
    console.log(`확인 ${results.length}건 중 통과 ${results.length - failed}건, 실패 ${failed}건`);
    if (failed) {
      console.log('\n실패한 항목:');
      results.filter((r) => !r.ok).forEach((r) => console.log(`  - ${r.label}${r.detail ? ` (${r.detail})` : ''}`));
    }
    process.exit(failed ? 1 : 0);
  });
