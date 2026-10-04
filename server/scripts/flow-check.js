/**
 * 업무 흐름 점검 — 장기렌트
 *
 * 고객이 들어온 순간부터 입금·손익 확인까지, 화면이 서버에 보내는 순서 그대로 실제 서버를 돌려 본다.
 * 기능을 고칠 때마다 이걸 돌려 앞뒤 단계가 여전히 이어지는지 확인한다.
 *
 *   cd server && node scripts/flow-check.js
 *
 * 안전장치
 * - 이 컴퓨터의 MongoDB에 시험 전용 DB(rentbenefit_flowcheck)를 만들어 쓴다. 운영 DB(Atlas)에는 붙지 않는다.
 * - OneDrive 대신 임시 폴더에 저장하고(DOCUMENT_STORAGE_DIR), 메일·Outlook·OCR 연결 정보는 비워서 띄운다.
 *   청구서 메일은 sendEmail=false로 보낸다. 실제 고객에게 나가는 것은 없다.
 * - 시작할 때마다 시험 DB와 임시 폴더를 비우고 처음부터 한다.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5055;
const BASE = `http://127.0.0.1:${PORT}`;
const TEST_DB = 'mongodb://127.0.0.1:27017/rentbenefit_flowcheck';
const STORAGE_DIR = path.join(os.tmpdir(), 'rentbenefit-flowcheck', 'onedrive');
const SERVER_LOG = path.join(os.tmpdir(), 'rentbenefit-flowcheck', 'server.log');

// ───────────────────────── 결과 기록

const results = [];
let currentStep = '';

const step = (title) => {
  currentStep = title;
  console.log(`\n■ ${title}`);
};

const check = (label, ok, detail = '') => {
  results.push({ step: currentStep, label, ok: Boolean(ok), detail });
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  return Boolean(ok);
};

class StepFailed extends Error {}

// ───────────────────────── 서버와 DB

const assertSafeDb = (uri) => {
  const { hostname, pathname } = new URL(uri);
  if (!['127.0.0.1', 'localhost'].includes(hostname) || !pathname.endsWith('_flowcheck')) {
    throw new Error(`시험 DB가 아닙니다: ${uri}. 이 컴퓨터의 *_flowcheck DB에서만 돌린다.`);
  }
};

const startServer = () => {
  fs.mkdirSync(path.dirname(SERVER_LOG), { recursive: true });
  const log = fs.openSync(SERVER_LOG, 'w');
  const env = {
    ...process.env,
    PORT: String(PORT),
    NODE_ENV: 'development',
    // .env의 운영 DB 주소보다 먼저 잡히도록 둘 다 덮는다(dotenv는 이미 있는 값을 덮지 않는다)
    MONGODB_ATLAS_URL: TEST_DB,
    MONGO_URI: TEST_DB,
    DOCUMENT_STORAGE_DIR: STORAGE_DIR,
    // 외부 연결을 모두 끊는다. 비어 있으면 해당 기능은 실패로 끝나고 실제 계정에 닿지 않는다.
    AZURE_TENANT_ID: '',
    AZURE_CLIENT_ID: '',
    AZURE_CLIENT_SECRET: '',
    OUTLOOK_TARGET_EMAIL: '',
    ONEDRIVE_TARGET_EMAIL: '',
    INVOICE_SENDER_EMAIL: '',
    CLOVA_OCR_INVOKE_URL: '',
    CLOVA_OCR_SECRET: ''
  };
  return spawn(process.execPath, ['index.js'], { cwd: SERVER_DIR, env, stdio: ['ignore', log, log] });
};

const waitForServer = async () => {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${BASE}/`);
      if (res.ok) return;
    } catch { /* 아직 안 떴다 */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`서버가 30초 안에 뜨지 않았습니다. 로그: ${SERVER_LOG}`);
};

let token = '';

/** API 호출. 실패하면 응답 내용을 보여 주고 그 단계를 멈춘다. */
const api = async (method, url, body, { expect = [200, 201], form = false } = {}) => {
  const headers = { Authorization: `Bearer ${token}` };
  if (body && !form) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers,
    body: body ? (form ? body : JSON.stringify(body)) : undefined
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!expect.includes(res.status)) {
    check(`${method} ${url} 응답`, false, `HTTP ${res.status} ${typeof data === 'object' ? (data.message || JSON.stringify(data).slice(0, 200)) : String(data).slice(0, 200)}`);
    throw new StepFailed();
  }
  return data;
};

// 활동 기록은 저장이 끝난 뒤 따로 남기므로 잠깐 기다렸다 본다
const findActivity = async (action, targetId) => {
  await new Promise((r) => setTimeout(r, 400));
  const query = { action };
  if (targetId) query['target.id'] = new mongoose.Types.ObjectId(String(targetId));
  return mongoose.connection.collection('activitylogs').findOne(query);
};

const ymd = (d) => new Date(d).toISOString().slice(0, 10);

// ───────────────────────── 업무 흐름

const ctx = {};

const steps = [
  ['0. 준비 — 직원 계정으로 로그인', async () => {
    const email = 'flowcheck@rentbenefit.test';
    const password = 'Flowcheck!2026';
    await api('POST', '/api/users', {
      email, password, name: '흐름점검', phone: '010-0000-0000', department: '점검', agreedToTerms: true
    }, { expect: [201] });
    // 가입하면 승인 대기다. 시험 DB라 여기서 바로 승인하고 편집 권한을 준다.
    await mongoose.connection.collection('users').updateOne({ email }, { $set: { status: 'ACTIVE', role: 'editor' } });
    const login = await fetch(`${BASE}/api/users/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password })
    }).then((r) => r.json());
    token = login.token;
    check('로그인하고 토큰을 받았다', token, login.role);
  }],

  ['1. 문의 접수 (영업부)', async () => {
    ctx.customer = await api('POST', '/api/customers', {
      name: '점검고객', bizNo: `999-99-${String(Date.now()).slice(-5)}`, contactName: '김담당',
      contactPhone: '010-1234-5678', email: 'flowcheck-customer@rentbenefit.test'
    });
    check('고객이 등록되었다', ctx.customer?._id, ctx.customer?.customerId);

    ctx.inquiry = await api('POST', '/api/inquiries', { customerId: ctx.customer._id, content: '그랜저 장기렌트 48개월 문의' });
    check('문의가 접수되었다', ctx.inquiry?._id, ctx.inquiry?.status);
    check('활동 기록 "문의 접수"가 남았다', await findActivity('문의 접수', ctx.inquiry._id));
  }],

  ['2. 견적서 작성 (영업부)', async () => {
    ctx.pricing = {
      basePrice: 45000000, optionPrice: 2000000, discount: 1000000, deliveryFee: 300000,
      deposit: 5000000, advancePayment: 0, takeoverPrice: 20000000, monthlyFee: 890000
    };
    ctx.quote = await api('POST', '/api/quotes', {
      customerId: ctx.customer._id, partyType: '개인', customerName: ctx.customer.name,
      vehicleModel: '그랜저', vehicleSpec: '2.5 가솔린 캘리그래피', totalPrice: 46300000,
      monthlyEstimates: [{ termMonths: 48, monthlyFee: 890000, contractType: '렌트' }],
      pricing: ctx.pricing
    });
    check('견적서가 저장되었다', ctx.quote?._id, ctx.quote?.status);
    check('활동 기록 "견적 작성"이 남았다', await findActivity('견적 작성', ctx.quote._id));
  }],

  ['3. 계약서 등록 전환 — 견적에서 넘어감 (영업부 → 계약·출고부)', async () => {
    // 날짜는 고정한다. 오늘 날짜를 쓰면 돌리는 날에 따라 1회차가 이번 달/다음 달로 갈려 결과가 흔들린다.
    // 9/27 계약 + 9/27 개시 + 25일 결제 = 1회차(9/25)가 계약일보다 앞서는 조합이다(5단계에서 쓴다).
    ctx.contractDate = '2026-09-27';
    ctx.draft = await api('POST', '/api/contracts/draft', {
      customerId: ctx.customer._id, quoteId: ctx.quote._id, partyType: '개인',
      contractDate: ctx.contractDate, termMonths: 48, pricing: ctx.pricing,
      vehicleInfo: { model: '그랜저', spec: '2.5 가솔린 캘리그래피', vehiclePrice: 46000000 },
      terms: { lateInterestRate: 24, earlyTerminationRate: 30 }
    });
    check('임시저장 계약이 만들어졌다', ctx.draft?.status === '임시저장', `${ctx.draft?.contractNo} / ${ctx.draft?.status}`);
    const quote = await api('GET', `/api/quotes/${ctx.quote._id}`);
    check('견적 상태가 "계약전환"이 되었다', quote?.status === '계약전환', quote?.status);
  }],

  ['4. 계약서 등록 — 계약서 화면에서 "등록" (계약·출고부)', async () => {
    // 계약서 등록 화면의 buildContractPayload와 같은 모양
    ctx.contract = await api('PUT', `/api/contracts/${ctx.draft._id}`, {
      customerId: ctx.customer._id, quoteId: ctx.quote._id, partyType: '개인',
      contractDate: ctx.contractDate, termMonths: 48, pricing: ctx.pricing,
      vehicleInfos: [{ model: '그랜저', vehiclePrice: 46000000, color: '블랙', insurance: { type: 'standard' }, maintenance: { enabled: false } }],
      vehicleInfo: { model: '그랜저' },
      terms: { lateInterestRate: 24, earlyTerminationRate: 30 },
      status: '진행중', finalize: true
    });
    check('계약 상태가 "진행중"이 되었다', ctx.contract?.status === '진행중', ctx.contract?.status);
    ctx.vehicle = ctx.contract?.vehicles?.[0];
    check('렌트차량 DB에 차량이 만들어졌다', ctx.vehicle?._id, `${ctx.vehicle?.carModel} / ${ctx.vehicle?.status}`);
    check('차량 월 렌트료가 계약 금액으로 들어갔다', ctx.vehicle?.monthlyFee === ctx.pricing.monthlyFee, `${ctx.vehicle?.monthlyFee}`);

    const saved = await mongoose.connection.collection('contracts').findOne({ _id: new mongoose.Types.ObjectId(ctx.contract._id) });
    check('계약 조건(연체이율 24%)이 계약에 저장되었다', saved?.terms?.lateInterestRate === 24, `저장된 값: ${saved?.terms?.lateInterestRate ?? '없음'}`);
    check('계약 폴더 이름(docFolderName)이 정해졌다', saved?.docFolderName, saved?.docFolderName || '없음');

    const partyDir = fs.existsSync(STORAGE_DIR) ? fs.readdirSync(STORAGE_DIR, { recursive: true }).filter((p) => p.includes(ctx.customer.name)) : [];
    check('계약자 서류 폴더가 만들어졌다', partyDir.length > 0, partyDir[0] || '없음');

    const ledger = await mongoose.connection.collection('vehicleledgers').findOne({ vehicle: new mongoose.Types.ObjectId(ctx.vehicle._id) });
    ctx.ledgerId = ledger?._id;
    check('차량 손익 원장(갑지)이 만들어졌다', ledger, ledger?.ledgerNo);
    check('활동 기록 "계약 등록"이 남았다', await findActivity('계약 등록', ctx.contract._id));
  }],

  ['5. 출고 준비 — 번호판·인도일·결제일 입력 (계약·출고부)', async () => {
    const res = await api('PUT', `/api/vehicles/${ctx.vehicle._id}`, {
      plateNo: '99허9999', vin: 'KMHFLOWCHECK00001', year: '2026',
      deliveryDate: ctx.contractDate, rentBillingDate: ctx.contractDate, monthlyPaymentDay: '25',
      status: '장기렌트'
    });
    check('차량 정보가 저장되었다', res?.success);
    check('차량 상태가 "장기렌트"가 되었다', res?.vehicle?.status === '장기렌트', res?.vehicle?.status);
    check('활동 기록 "차량 상태 변경"이 남았다', await findActivity('차량 상태 변경', ctx.vehicle._id));

    // 1회차(9/25)가 계약일(9/27)보다 앞선다. 이런 계약은 없으므로 회차표를 만들지 않고 계약일을 고치라고 해야 한다.
    check('1회차가 계약일보다 앞서면 "계약일을 고치라"고 안내한다', /1회차 출금일.*계약일/.test(res?.message || ''), res?.message);
    check('화면이 주의 알림으로 띄울 수 있게 따로 알려 준다', res?.billingWarning?.code === 'FIRST_DUE_BEFORE_CONTRACT', res?.billingWarning?.code);
    const none = await api('GET', `/api/billing-schedules/contract/${ctx.contract._id}`, null, { expect: [200, 404] });
    check('그 상태로는 회차표를 만들지 않는다', !none?.schedule?.rounds?.length);
  }],

  ['5-2. 계약일 고치기 → 회차표가 만들어지는지 (계약·출고부)', async () => {
    ctx.contractDate = '2026-09-20';
    const updated = await api('PUT', `/api/contracts/${ctx.contract._id}`, { contractDate: ctx.contractDate });
    check('계약일이 9/20으로 고쳐졌다', ymd(updated?.contractDate) === ctx.contractDate, ymd(updated?.contractDate));

    const sched = await api('GET', `/api/billing-schedules/contract/${ctx.contract._id}`);
    ctx.schedule = sched?.schedule;
    check('계약일을 고치자 청구 회차표가 저절로 만들어졌다', ctx.schedule?.rounds?.length, `${ctx.schedule?.rounds?.length ?? 0}회차`);
    check('회차 수가 계약 기간(48개월)과 같다', ctx.schedule?.rounds?.length === 48);
    const first = ctx.schedule?.rounds?.[0];
    check('1회차 출금일이 2026-09-25다', first && ymd(first.dueDate) === '2026-09-25', first ? ymd(first.dueDate) : '');
    check('1회차 출금일이 계약일보다 앞서지 않는다', first && ymd(first.dueDate) >= ctx.contractDate);
    check('1회차 청구액이 0보다 크다', first?.total > 0, `${first?.total?.toLocaleString()}원`);
  }],

  ['6. 청구서 발행 (청구부) — 메일은 보내지 않음', async () => {
    const form = new FormData();
    const pdf = Buffer.from('%PDF-1.4\n% flowcheck invoice\n%%EOF\n');
    form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'invoice.pdf');
    form.append('sendEmail', 'false');
    const res = await api('POST', `/api/billing-schedules/${ctx.schedule._id}/rounds/1/issue`, form, { form: true });
    check('청구서가 저장되었다', res?.success, res?.localPath);
    check('저장한 파일이 실제로 있다', res?.localPath && fs.existsSync(path.join(STORAGE_DIR, ...res.localPath.split('/'))));

    const sched = await api('GET', `/api/billing-schedules/contract/${ctx.contract._id}`);
    const round = sched?.schedule?.rounds?.[0];
    check('1회차 상태가 "청구됨"이 되었다', round?.status === '청구됨', round?.status);
    check('활동 기록 "청구서 발행"이 남았다', await findActivity('청구서 발행', ctx.schedule._id));
    ctx.roundTotal = round?.total;
  }],

  ['7. 입금 확인 (재무부)', async () => {
    const res = await api('PATCH', `/api/billing-schedules/${ctx.schedule._id}/rounds/1/payment`, { paidAmount: ctx.roundTotal });
    check('1회차가 "입금완료"가 되었다', res?.round?.status === '입금완료', res?.message);
    check('활동 기록 "입금 입력"이 남았다', await findActivity('입금 입력', ctx.schedule._id));
  }],

  ['8. 손익 확인 — 원장에 입금이 잡히는지 (재무부)', async () => {
    if (!check('원장이 있다', ctx.ledgerId)) throw new StepFailed();
    const ledger = await api('POST', `/api/ledgers/${ctx.ledgerId}/sync`);
    const rent = (ledger?.entries || []).find((e) => e.round === 1 && e.side === '입금');
    check('원장에 "렌트료 1회차" 입금이 들어왔다', rent, rent ? `${rent.label} ${rent.amount?.toLocaleString()}원` : '없음');
    check('입금액이 청구액과 같다', rent?.amount === ctx.roundTotal, `${rent?.amount} / ${ctx.roundTotal}`);
    const deposit = (ledger?.entries || []).find((e) => /보증금/.test(e.label || ''));
    check('계약의 보증금이 원장에 들어왔다', deposit?.amount === ctx.pricing.deposit, deposit ? `${deposit.amount?.toLocaleString()}원` : '없음');
  }],

  ['8-2. 청구서 보관함 — 지난 청구서 보기, 과태료·자부담금 더하기 (청구부)', async () => {
    // 발행한 회차(1회차)는 저장해 둔 PDF를 그대로 연다
    const file = await fetch(`${BASE}/api/billing-schedules/${ctx.schedule._id}/rounds/1/file`, { headers: { Authorization: `Bearer ${token}` } });
    const body = Buffer.from(await file.arrayBuffer()).toString();
    check('1회차 "보낸 PDF 보기"가 저장된 파일을 연다', file.ok && body.includes('flowcheck invoice'), `HTTP ${file.status} ${file.headers.get('content-type')}`);
    const none = await fetch(`${BASE}/api/billing-schedules/${ctx.schedule._id}/rounds/2/file`, { headers: { Authorization: `Bearer ${token}` } });
    check('발행하지 않은 2회차는 "저장된 파일이 없다"고 답한다', none.status === 404);

    // 2회차에 과태료·자부담금을 더한다
    const rent = ctx.schedule.rounds[1].monthlyRent;
    const res = await api('PUT', `/api/billing-schedules/${ctx.schedule._id}/rounds/2`, {
      extras: [{ label: '과태료 (속도위반)', amount: 40000 }, { label: '자부담금', amount: 300000 }], other: 340000
    });
    check('2회차에 과태료·자부담금이 저장되었다', res?.round?.extras?.length === 2, (res?.round?.extras || []).map((e) => `${e.label} ${e.amount}`).join(', '));
    check('2회차 청구액 = 월 렌트료 + 340,000원', res?.round?.total === rent + 340000, `${res?.round?.total?.toLocaleString()}원`);

    // 항목을 모두 빼면 청구액이 월 렌트료로 돌아와야 한다(지운 금액이 남으면 안 된다)
    const cleared = await api('PUT', `/api/billing-schedules/${ctx.schedule._id}/rounds/2`, { extras: [], other: 0 });
    check('항목을 모두 빼면 청구액이 월 렌트료로 돌아온다', cleared?.round?.total === rent, `${cleared?.round?.total?.toLocaleString()}원`);
  }],

  // 견적 없이 계약서 화면에서 곧바로 등록하는 길. 3~4단계와 다른 API를 타므로 따로 본다.
  ['9. (다른 길) 견적 없이 계약서 바로 등록 (계약·출고부)', async () => {
    const contract = await api('POST', '/api/contracts', {
      customerId: ctx.customer._id, partyType: '개인', contractDate: ctx.contractDate, termMonths: 36,
      pricing: { ...ctx.pricing, monthlyFee: 650000 },
      vehicleInfos: [{ model: '쏘렌토', vehiclePrice: 38000000 }],
      terms: { lateInterestRate: 20, earlyTerminationRate: 30 }
    }, { expect: [201] });
    check('계약 상태가 "진행중"이다', contract?.status === '진행중', contract?.contractNo);
    check('차량이 만들어졌다', contract?.vehicles?.[0]?._id, contract?.vehicles?.[0]?.carModel);
    const saved = await mongoose.connection.collection('contracts').findOne({ _id: new mongoose.Types.ObjectId(contract._id) });
    check('계약 조건(연체이율 20%)이 저장되었다', saved?.terms?.lateInterestRate === 20, `${saved?.terms?.lateInterestRate}`);
    check('계약 폴더 이름이 정해졌다', saved?.docFolderName, saved?.docFolderName || '없음');
    const ledger = await mongoose.connection.collection('vehicleledgers').findOne({ vehicle: new mongoose.Types.ObjectId(contract.vehicles[0]._id) });
    check('손익 원장이 만들어졌다', ledger, ledger?.ledgerNo);
    check('활동 기록 "계약 등록"이 남았다', await findActivity('계약 등록', contract._id));
  }]
];

// ───────────────────────── 실행

const main = async () => {
  assertSafeDb(TEST_DB);
  await mongoose.connect(TEST_DB);
  await mongoose.connection.dropDatabase();
  fs.rmSync(STORAGE_DIR, { recursive: true, force: true });

  console.log('업무 흐름 점검 — 장기렌트 (시험 DB: rentbenefit_flowcheck, 외부 연결 없음)');
  const server = startServer();
  let stopped = false;
  try {
    await waitForServer();
    for (const [title, run] of steps) {
      step(title);
      if (stopped) { check('앞 단계가 실패해 건너뜀', false); continue; }
      try {
        await run();
      } catch (err) {
        if (!(err instanceof StepFailed)) check('예상하지 못한 오류', false, err.message);
        // 요청 자체가 실패하면 뒤 단계가 기대는 값(고객, 계약, 회차표)이 없어 더 가 봐야 의미가 없다.
        // 확인 항목이 틀린 것만으로는 멈추지 않는다. 한 번에 문제를 다 보는 편이 낫다.
        stopped = true;
      }
    }
  } finally {
    server.kill();
    await mongoose.disconnect();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n━━━━━━━━ 결과: 확인 ${results.length}건 중 ${results.length - failed.length}건 통과, ${failed.length}건 실패`);
  failed.forEach((r) => console.log(`  ❌ [${r.step}] ${r.label}${r.detail ? ` — ${r.detail}` : ''}`));
  console.log(`서버 로그: ${SERVER_LOG}`);
  process.exit(failed.length ? 1 : 0);
};

main().catch((err) => {
  console.error('점검을 시작하지 못했습니다:', err.message);
  process.exit(2);
});
