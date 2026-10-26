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
import XLSX from 'xlsx';

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
  }],

  ['10. 대표 대시보드 — 경영 요약', async () => {
    // 매출 규모가 담겨 있어 관리자만 본다
    const denied = await fetch(`${BASE}/api/dashboard/executive`, { headers: { Authorization: `Bearer ${token}` } });
    check('직원(editor) 계정은 경영 요약을 볼 수 없다', denied.status === 403, `HTTP ${denied.status}`);

    await mongoose.connection.collection('users').updateOne({ email: 'flowcheck@rentbenefit.test' }, { $set: { role: 'admin' } });
    const ex = await api('GET', '/api/dashboard/executive');
    // 시험 자료: 그랜저(장기렌트, 월 890,000) 1대 운용 + 쏘렌토(계약중, 월 650,000) 1대 출고 대기
    check('운용 차량이 1대(그랜저)로 잡힌다', ex?.fleet?.operatingCount === 1, `${ex?.fleet?.operatingCount}대`);
    check('월 렌트 매출이 890,000원이다', ex?.fleet?.operatingMonthlyRent === 890000, `${ex?.fleet?.operatingMonthlyRent}`);
    check('출고 대기 1대(쏘렌토, 월 650,000원)가 따로 잡힌다', ex?.fleet?.waiting?.count === 1 && ex?.fleet?.waiting?.monthlyRent === 650000,
      `${ex?.fleet?.waiting?.count}대 / ${ex?.fleet?.waiting?.monthlyRent}`);
    check('이번 달 견적 1건이 영업 흐름에 잡힌다', ex?.funnel?.thisMonth?.quotes >= 1 || ex?.funnel?.lastMonthFull?.quotes >= 1, JSON.stringify(ex?.funnel?.thisMonth));
    check('만기 목록이 응답에 있다', Array.isArray(ex?.expiring?.items), `${ex?.expiring?.count}건`);
    // 1회차는 7단계에서 입금완료로 처리했다. 미납·기록 끊김이 없어야 하고, 입금 기록 기준일이 잡혀야 한다.
    const col = ex?.collections;
    check('입금 기록 기준일이 잡힌다(1회차 입금)', col?.lastPaidAt, String(col?.lastPaidAt || '없음').slice(0, 10));
    check('미납이 0건이다', col?.unpaid?.count === 0, `${col?.unpaid?.count}건`);
    check('입금 기록이 끊긴 계약이 없다', col?.streakCount === 0, `${col?.streakCount}건`);
    const billingDept = (ex?.activityToday || []).find((d) => d.dept === '청구부');
    check('부서별 오늘 한 일에 "청구부 청구서 발행"이 잡힌다', billingDept?.actions?.some((a) => a.action === '청구서 발행'),
      (ex?.activityToday || []).map((d) => `${d.dept}: ${d.actions.map((a) => `${a.action} ${a.count}`).join(', ')}`).join(' / '));
    await mongoose.connection.collection('users').updateOne({ email: 'flowcheck@rentbenefit.test' }, { $set: { role: 'editor' } });
  }],

  ['11. 만기 처리 — 계약 연장 (계약·출고부)', async () => {
    const oid = (id) => new mongoose.Types.ObjectId(String(id));
    const preview = await api('GET', `/api/contracts/${ctx.contract._id}/extension-preview`);
    check('연장 번호가 기존 번호 -1로 제안된다', preview?.contractNo === `${ctx.contract.contractNo}-1`, preview?.contractNo);

    // 만기(2030-09) 전에 일찍 연장한다: 2027-03-01부터 24개월, 월 950,000원
    const res = await api('POST', `/api/contracts/${ctx.contract._id}/extend`, {
      startDate: '2027-03-01', termMonths: 24, signedOverrideReason: '흐름 점검 (서명 완료본 없이)',
      vehicles: [{ vehicleId: ctx.vehicle._id, monthlyFee: 950000, takeoverPrice: 15000000 }]
    }, { expect: [201] });
    ctx.ext1 = res?.contract;
    check('연장 계약이 만들어졌다', ctx.ext1?.contractNo === `${ctx.contract.contractNo}-1`, `${ctx.ext1?.contractNo} · ${res?.message}`);

    const prev = await mongoose.connection.collection('contracts').findOne({ _id: oid(ctx.contract._id) });
    check('이전 계약은 지우지 않고 "종료(연장)"로 닫혔다', prev?.status === '종료' && prev?.endReason === '연장', `${prev?.status}/${prev?.endReason}`);
    check('이전 계약의 실제 종료일이 연장 전날이다', ymd(prev?.actualEndDate) === '2027-02-28', ymd(prev?.actualEndDate));

    const sameCar = await mongoose.connection.collection('vehicles').countDocuments({ plateNo: '99허9999' });
    check('차량이 새로 생기지 않았다(번호판 1대)', sameCar === 1, `${sameCar}대`);
    const car = await mongoose.connection.collection('vehicles').findOne({ _id: oid(ctx.vehicle._id) });
    check('차량이 연장 계약에 붙었다', String(car?.contract) === String(ctx.ext1?._id));
    check('차량 월 렌트료가 연장 조건(950,000원)으로 바뀌었다', car?.monthlyFee === 950000, `${car?.monthlyFee}`);

    const ext = await mongoose.connection.collection('contracts').findOne({ _id: oid(ctx.ext1._id) });
    check('보증금 500만 원이 승계되었다', ext?.pricing?.deposit === 5000000 && ext?.depositCarriedOver === true, `${ext?.pricing?.deposit}`);
    check('연장 계약이 이전 계약과 연결되었다', String(ext?.previousContract) === String(ctx.contract._id) && ext?.contractKind === '연장');

    const newSched = await api('GET', `/api/billing-schedules/contract/${ctx.ext1._id}`);
    const nr = newSched?.schedule?.rounds || [];
    check('연장 회차표가 24회차로 새로 만들어졌다', nr.length === 24, `${nr.length}회차`);
    const oldSched = await api('GET', `/api/billing-schedules/contract/${ctx.contract._id}`);
    const or = oldSched?.schedule?.rounds || [];
    check('이전 회차표의 입금 기록(1회차)은 그대로 남았다', or[0]?.status === '입금완료', or[0]?.status);
    // 이전 계약은 연장 시작 전까지 간 개월 수만큼 회차를 남기고 나머지(미청구)는 정리한다
    const prevContract = await mongoose.connection.collection('contracts').findOne({ _id: oid(ctx.contract._id) });
    const monthsUsed = (() => {
      const a = new Date(new Date(prevContract.contractDate).getTime() + 9 * 3600e3); const b = new Date('2027-03-01T09:00:00Z');
      return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) - (b.getUTCDate() < a.getUTCDate() ? 1 : 0);
    })();
    check('이전 계약은 연장 전까지 간 개월 수만큼 회차가 남았다', or.length === monthsUsed, `${or.length}회차 / ${monthsUsed}개월, 마지막 ${or.length ? ymd(or[or.length - 1].dueDate) : '-'}`);
    // 연장 1회차는 이전 계약 마지막 회차의 다음 달 결제일 — 같은 날 두 번 청구되지 않는다(대표님 2026-10-26, 신흥정보통신)
    const lastOld = or.length ? new Date(or[or.length - 1].dueDate) : null;
    check('연장 1회차 출금일이 이전 계약 마지막 회차보다 뒤다', nr[0] && lastOld && new Date(nr[0].dueDate) > lastOld, `${nr[0] ? ymd(nr[0].dueDate) : ''} / 이전 마지막 ${lastOld ? ymd(lastOld) : '-'}`);
    check('연장 1회차 청구액이 950,000원이다', nr[0]?.total === 950000, `${nr[0]?.total}`);

    const ledger = await mongoose.connection.collection('vehicleledgers').findOne({ vehicle: oid(ctx.vehicle._id) });
    const periods = ledger?.contractPeriods || [];
    check('원장은 그대로 한 장이고 연장 구간이 붙었다', periods.length === 2 && String(periods[1].contract) === String(ctx.ext1._id), `${periods.length}구간`);
    const deposits = (ledger?.entries || []).filter((e) => e.category === '보증금' && e.amount > 0);
    check('승계된 보증금이 원장에 두 번 잡히지 않는다', deposits.length === 1 && deposits[0].amount === 5000000, deposits.map((d) => d.amount).join(', '));
    const carPrices = (ledger?.entries || []).filter((e) => e.category === '차량가' && e.amount > 0);
    check('차량가가 원장에 한 번만 있다', carPrices.length === 1, `${carPrices.length}줄`);
    check('활동 기록 "계약 연장"이 남았다', await findActivity('계약 연장', ctx.ext1._id));

    // 한 번 더 연장하면 -2
    const res2 = await api('POST', `/api/contracts/${ctx.ext1._id}/extend`, {
      termMonths: 12, signedOverrideReason: '흐름 점검 (서명 완료본 없이)', vehicles: [{ vehicleId: ctx.vehicle._id, monthlyFee: 900000, takeoverPrice: 12000000 }]
    }, { expect: [201] });
    check('두 번째 연장은 -2 번호를 받는다', res2?.contract?.contractNo === `${ctx.contract.contractNo}-2`, res2?.contract?.contractNo);
    const ext2 = await mongoose.connection.collection('contracts').findOne({ _id: oid(res2?.contract?._id) });
    check('두 번째 연장이 첫 연장 기간 바로 다음 날(2029-03-01)부터 빈틈없이 시작한다', ymd(ext2?.contractDate) === '2029-03-01', ymd(ext2?.contractDate));
    const ledger2 = await mongoose.connection.collection('vehicleledgers').findOne({ vehicle: oid(ctx.vehicle._id) });
    check('원장에 세 번째 구간이 붙었다', (ledger2?.contractPeriods || []).length === 3, `${(ledger2?.contractPeriods || []).length}구간`);
    const tk2 = (ledger2?.entries || []).filter((e) => e.category === '인수가' && e.amount > 0);
    check('연장을 거듭해도 인수가는 마지막 계약 것(1,200만 원) 한 줄뿐이다', tk2.length === 1 && tk2[0].amount === 12000000, tk2.map((t) => t.amount).join(', '));

    // 끝난 계약을 지우면 같은 차량을 쓰는 지금 계약의 차가 사라진다. 막혀야 한다.
    await api('DELETE', `/api/contracts/${ctx.contract._id}`, null, { expect: [409] });
    check('연장으로 이어진 이전 계약은 삭제할 수 없다', true);
    await api('POST', `/api/contracts/${ctx.contract._id}/archive`, null, { expect: [400] });
    check('끝난 계약은 보관(상태 덮어쓰기)할 수 없다', true);
    const stillThere = await mongoose.connection.collection('vehicles').countDocuments({ _id: oid(ctx.vehicle._id) });
    check('차량은 그대로 있다', stillThere === 1);

    ctx.ext2 = res2?.contract;

    // 연장 번호가 생겨도 이 고객의 다음 신규 계약번호가 건너뛰지 않는다
    const draft = await api('POST', '/api/contracts/draft', { customerId: ctx.customer._id, contractDate: '2026-09-15', termMonths: 12, pricing: {} });
    check('다음 신규 계약번호는 -03이다(연장 번호를 세지 않는다)', /-2609-03$/.test(draft?.contractNo || ''), draft?.contractNo);
  }],

  ['12. 단기렌트 — 월 목표(견적 3년·인수가 30%·정비 포함)를 매달 벌어 오는지 (자금팀 → 대표)', async () => {
    // 석 달 전 1일에 들인 K5. 두 달 전 50만 원, 지난달 120만 원(+보증금 300만 원) 벌었다.
    const now = new Date();
    const kst = (y, m, d) => new Date(Date.UTC(y, m, d) - 9 * 3600 * 1000).toISOString();
    const y = now.getFullYear();
    const m = now.getMonth();
    const created = await api('POST', '/api/ledgers', {
      header: { carModel: 'K5 하이브리드 프레스티지', plateNo: '88하8888', carPrice: 35550000, cc: 1598, deliveredAt: kst(y, m - 3, 1) }
    }, { expect: [201] });
    await api('PUT', `/api/ledgers/${created._id}`, { ledgerType: '단기렌트' });
    await api('PUT', `/api/ledgers/${created._id}/entries`, { entries: [
      { side: '입금', group: '고객입금', category: '기타', label: '렌콜-12가3456', amount: 500000, bank: 'B', date: kst(y, m - 2, 10) },
      { side: '입금', group: '고객입금', category: '기타', label: '렌콜-34나5678', amount: 1200000, bank: 'B', date: kst(y, m - 1, 12) },
      { side: '입금', group: '고객입금', category: '보증금', label: '보증금', amount: 3000000, bank: 'B', date: kst(y, m - 1, 12) }
    ] });

    const calc = await api('GET', `/api/ledgers/${created._id}/short-term`);
    check('견적 식으로 월 목표가 계산된다(K5 약 100만 원)', calc?.calculatedTarget > 900000 && calc?.calculatedTarget < 1200000, `${calc?.calculatedTarget}`);
    check('출고일부터 센다', calc?.performance?.start?.source === 'delivered', calc?.performance?.start?.source);

    // 대표님이 목표를 100만 원으로 정했다
    await api('PUT', `/api/ledgers/${created._id}`, { shortTerm: { monthlyTarget: 1000000 } });
    const st = await api('GET', `/api/ledgers/${created._id}/short-term`);
    const p = st?.performance || {};
    check('직접 정한 목표가 먼저 쓰인다', st?.targetSource === 'manual' && p.monthlyTarget === 1000000, `${st?.targetSource} ${p.monthlyTarget}`);
    check('지난달 120만 원을 벌어 목표를 채웠다(보증금은 빼고 센다)', p.lastMonth?.actual === 1200000 && p.lastMonth?.rate >= 1, `${p.lastMonth?.actual} ${p.lastMonth?.rate}`);
    check('지난 3개월 중 목표를 채운 달은 1개월', p.metMonths === 1 && p.doneMonths === 3, `${p.metMonths}/${p.doneMonths}`);
    check('지금까지 번 돈은 170만 원', p.cumActual === 1700000, `${p.cumActual}`);

    await mongoose.connection.collection('users').updateOne({ email: 'flowcheck@rentbenefit.test' }, { $set: { role: 'admin' } });
    const ex = await api('GET', '/api/dashboard/executive');
    const sum = ex?.shortTermTargets;
    check('경영 요약에 단기렌트 목표 달성이 나온다', sum?.count === 1 && sum.rows?.[0]?.plateNo === '88하8888', `${sum?.count}대`);
    check('지난달 목표 미달 차가 없다', sum?.lastMonth?.belowCount === 0 && sum?.lastMonth?.actual === 1200000, JSON.stringify(sum?.lastMonth));
    await mongoose.connection.collection('users').updateOne({ email: 'flowcheck@rentbenefit.test' }, { $set: { role: 'editor' } });
  }],

  ['12-2. 단기렌트·사고대차 단가표 — 1일·1주·1개월 요금, 대여 중 표시 (렌트팀)', async () => {
    // 12단계의 K5: 기준 월 목표 100만 원, 1년차 ×1.1 → 1개월 110만 원, 1일 11만 원, 1주 44만 원
    const card = await api('GET', '/api/short-term-rates');
    const k5 = (card?.cars || []).find((c) => c.plateNo === '88하8888');
    check('단가표에 단기렌트 차가 나온다', !!k5, `${(card?.cars || []).length}대`);
    check('1개월 = 차령 반영 월 목표(110만 원)', k5?.rates?.month === 1100000, `${k5?.rates?.month}`);
    check('1일 = 1개월 × 10%(2,500원 올림), 1주 = 1일 × 4', k5?.rates?.day === 110000 && k5?.rates?.week === 440000, `${k5?.rates?.day} / ${k5?.rates?.week}`);
    check('하이브리드 K5는 사고대차 등급을 배기량(1,598cc 소형)이 아니라 K5 2.0 기준 중형 C로 잡는다', k5?.insurer?.grade === 'C' && k5?.insurer?.basis === 'hybrid', `${k5?.insurer?.grade} ${k5?.insurer?.basis}`);
    check('렌터카 차령 만료일이 나온다(소형 5년)', k5?.rentalLife?.years === 5, JSON.stringify(k5?.rentalLife));
    check('계산기용 공휴일 목록이 온다', Array.isArray(card?.holidays) && card.holidays.length > 0, `${card?.holidays?.length}일`);

    await api('PUT', '/api/short-term-rates', { vehicles: { [k5.ledgerId]: { day: 99000, renting: true } } });
    const after = (await api('GET', '/api/short-term-rates'))?.cars?.find((c) => c.plateNo === '88하8888');
    check('직접 정한 1일 요금과 대여 중 표시가 저장된다', after?.rates?.day === 99000 && after?.overridden?.day && after?.renting === true, `${after?.rates?.day} ${after?.renting}`);
    check('1주는 계산값 그대로다', after?.rates?.week === 440000, `${after?.rates?.week}`);

    // 요금 규칙은 관리자만
    await api('PUT', '/api/short-term-rates', { policy: { dayRatio: 0.12 } }, { expect: [403] });
    check('요금 규칙은 관리자가 아니면 못 바꾼다', true);
  }],

  ['13. 만기 처리 — 반납 → 단기 운용 → 재렌트 → 인수 (차량관리부·영업부)', async () => {
    const oid = (id) => new mongoose.Types.ObjectId(String(id));
    const db = mongoose.connection;
    const ledgerOf = () => db.collection('vehicleledgers').findOne({ vehicle: oid(ctx.vehicle._id) });

    // ── 반납: 두 번째 연장(2029-03 ~ 12개월) 중 2029-06-30에 일찍 돌려받고 단기렌트로 돌린다
    const ret = await api('POST', `/api/contracts/${ctx.ext2._id}/return`, {
      returnDate: '2029-06-30', mileage: 85000, damageCharge: 300000, nextUse: '단기렌트'
    });
    check('반납 처리가 되었다', ret?.success, ret?.message);
    const closed = await db.collection('contracts').findOne({ _id: oid(ctx.ext2._id) });
    check('계약이 "종료(반납)"로 닫혔다', closed?.status === '종료' && closed?.endReason === '반납', `${closed?.status}/${closed?.endReason}`);
    check('보증금 반환액이 기본으로 승계된 보증금(500만 원)이다', closed?.returnInfo?.depositRefund === 5000000, `${closed?.returnInfo?.depositRefund}`);
    let car = await db.collection('vehicles').findOne({ _id: oid(ctx.vehicle._id) });
    check('차량이 단기렌트로 바뀌고 주행거리가 남았다', car?.status === '단기렌트' && car?.currentMileage === 85000, `${car?.status} / ${car?.currentMileage}`);
    const sched = await api('GET', `/api/billing-schedules/contract/${ctx.ext2._id}`);
    const rounds = sched?.schedule?.rounds || [];
    check('반납일 뒤의 미청구 회차가 정리되었다(3~6월 4회차만 남음)', rounds.length === 4 && ymd(rounds[3].dueDate) === '2029-06-25', `${rounds.length}회차`);
    let ledger = await ledgerOf();
    const refund = (ledger?.entries || []).find((e) => e.side === '지출' && e.category === '보증금');
    check('원장에 보증금 반환(지출 500만 원)이 들어갔다', refund?.amount === 5000000, refund ? `${refund.label} ${refund.amount}` : '없음');
    const damage = (ledger?.entries || []).find((e) => e.label === '반납 손상 수리비(고객부담)');
    check('원장에 손상 수리비(입금 30만 원)가 들어갔다', damage?.amount === 300000);
    const gap = (ledger?.contractPeriods || []).slice(-1)[0];
    check('원장에 "반납 후 단기 운용" 구간이 열렸다', gap && !gap.contract && /단기/.test(gap.note || ''), gap?.note);
    const tkAfterReturn = (ledger?.entries || []).filter((e) => e.category === '인수가' && e.amount > 0);
    check('반납해서 차가 돌아왔으니 원장에 인수가 입금이 없다', tkAfterReturn.length === 0, tkAfterReturn.map((t) => t.amount).join(', ') || '없음');

    // 재고·단기 차를 직원이 저장해도 끝난 계약의 회차가 되살아나면 안 된다
    const saved = await api('PUT', `/api/vehicles/${ctx.vehicle._id}`, { notes: '반납 후 점검 완료' });
    const again = await api('GET', `/api/billing-schedules/contract/${ctx.ext2._id}`);
    check('반납한 차를 저장해도 끝난 계약의 회차가 되살아나지 않는다', (again?.schedule?.rounds || []).length === 4 && !saved?.billingWarning,
      `${(again?.schedule?.rounds || []).length}회차`);

    // 재고·단기 차가 아니면 재렌트할 수 없다 (출고 대기 중인 쏘렌토)
    const sorento = await db.collection('vehicles').findOne({ carModel: '쏘렌토' });
    await api('POST', '/api/contracts/rerent', { vehicleId: sorento._id }, { expect: [400] });
    check('운용 중이거나 출고 전인 차는 재렌트할 수 없다', true);

    // ── 재렌트: 새 고객이 중고로 36개월. 평가액은 중고차 사업부 금액을 직원이 넣는다
    const newCustomer = await api('POST', '/api/customers', { name: '재렌트고객', bizNo: `888-88-${String(Date.now()).slice(-5)}` });
    const rr = await api('POST', '/api/contracts/rerent', {
      vehicleId: ctx.vehicle._id, customerId: newCustomer._id, contractDate: '2029-08-01', termMonths: 36,
      monthlyFee: 700000, deposit: 3000000, appraisalValue: 25000000, monthlyPaymentDay: '10'
    }, { expect: [201] });
    ctx.rerent = rr?.contract;
    check('재렌트 계약이 새 고객 번호로 만들어졌다', ctx.rerent?.contractKind === '재렌트' && /^CUST\d+-2908-01$/.test(ctx.rerent?.contractNo || ''), `${ctx.rerent?.contractNo} · ${rr?.message}`);
    check('재렌트 계약이 이전(반납) 계약과 연결되었다', String(ctx.rerent?.previousContract) === String(ctx.ext2._id));
    const sameCar = await db.collection('vehicles').countDocuments({ plateNo: '99허9999' });
    check('재렌트해도 차량이 새로 생기지 않았다', sameCar === 1, `${sameCar}대`);
    car = await db.collection('vehicles').findOne({ _id: oid(ctx.vehicle._id) });
    check('차량이 장기렌트로 돌아오고 계약자가 새 고객으로 바뀌었다', car?.status === '장기렌트' && car?.contractorName === '재렌트고객' && String(car?.contract) === String(ctx.rerent._id),
      `${car?.status} / ${car?.contractorName}`);
    const rs = await api('GET', `/api/billing-schedules/contract/${ctx.rerent._id}`);
    const rr0 = rs?.schedule?.rounds || [];
    check('재렌트 회차표 36회차, 1회차는 2029-08-10', rr0.length === 36 && ymd(rr0[0].dueDate) === '2029-08-10', `${rr0.length}회차 / ${rr0[0] ? ymd(rr0[0].dueDate) : '-'}`);
    ledger = await ledgerOf();
    const ps = ledger?.contractPeriods || [];
    check('원장은 한 장, 구간이 신규·연장·연장·단기운용·재렌트 5개다', ps.length === 5 && String(ps[4].contract) === String(ctx.rerent._id), `${ps.length}구간`);
    check('단기 운용 구간이 재렌트 전날(2029-07-31)로 닫혔다', ymd(ps[3]?.endDate) === '2029-07-31', ymd(ps[3]?.endDate));
    const depositsIn = (ledger?.entries || []).filter((e) => e.side === '입금' && e.category === '보증금' && e.amount > 0).map((e) => e.amount).sort();
    check('보증금 입금은 최초 500만 원 + 새 고객 300만 원 두 줄이다(승계분은 다시 안 잡힘)', depositsIn.join(',') === '3000000,5000000', depositsIn.join(', '));
    check('차량가는 여전히 한 번만 잡힌다', (ledger?.entries || []).filter((e) => e.category === '차량가' && e.amount > 0).length === 1);
    check('활동 기록 "차량 반납"·"재렌트 계약"이 남았다', Boolean((await findActivity('차량 반납', ctx.ext2._id)) && (await findActivity('재렌트 계약', ctx.rerent._id))));

    // ── 인수: 재렌트 고객이 2031-01-15에 900만 원에 차를 산다
    const tk = await api('POST', `/api/contracts/${ctx.rerent._id}/takeover`, { takeoverDate: '2031-01-15', takeoverAmount: 9000000 });
    check('인수 처리가 되었다', tk?.success, tk?.message);
    const tc = await db.collection('contracts').findOne({ _id: oid(ctx.rerent._id) });
    check('계약이 "종료(인수)"로 닫혔다', tc?.status === '종료' && tc?.endReason === '인수');
    car = await db.collection('vehicles').findOne({ _id: oid(ctx.vehicle._id) });
    check('차량이 거래완료가 되었다', car?.status === '거래완료', car?.status);
    ledger = await ledgerOf();
    const takeovers = (ledger?.entries || []).filter((e) => e.category === '인수가' && e.amount > 0);
    check('원장에 인수가 900만 원이 한 줄 들어갔다', takeovers.length === 1 && takeovers[0].amount === 9000000, takeovers.map((t) => t.amount).join(', '));
    check('원장이 거래완료로 닫혔다', ledger?.status === '거래완료', ledger?.status);
    check('활동 기록 "차량 인수"가 남았다', await findActivity('차량 인수', ctx.rerent._id));
  }],

  ['회사 장부: 자금팀 엑셀 올리기 → 계정 바꾸기 → 고친 엑셀 다시 올리기', async () => {
    const oid = (id) => new mongoose.Types.ObjectId(String(id));
    const db = () => mongoose.connection;
    // 급여가 보이는 장부라 편집 권한으로는 열리지 않는다
    await api('GET', '/api/company-book/summary', null, { expect: [403] });
    check('편집 권한으로는 회사 장부를 볼 수 없다', true);
    await mongoose.connection.collection('users').updateOne({ email: 'flowcheck@rentbenefit.test' }, { $set: { role: 'admin' } });

    // 자금팀 엑셀과 같은 모양: 1행 칸 제목, 7행부터 내역·금액·날짜
    const book = (rows) => {
      const wb = XLSX.utils.book_new();
      const head = [['월급,탁송보험가입포함', '', '', '기타 비용/은행수수료', '', ''], [], [], [], [], ['내역', '금액', '날짜', '내역', '금액', '날짜']];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([...head, ...rows]), '고정비용');
      return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    };
    const upload = (buffer, apply) => {
      const fd = new FormData();
      fd.append('file', new Blob([buffer]), '렌트베네핏 입출금 리스트.xlsx');
      if (apply) fd.append('apply', '1');
      return api('POST', '/api/company-book/import', fd, { form: true });
    };
    const first = book([
      ['2025-1월 급여', 3000000, '2025-01-25', '미군부대 입찰 수수료', 55000000, '2024-11-06'],
      ['2025-2월 급여', 3100000, '2025-02-25', '미군부대 입찰 1차 환급', -20000000, '2025-07-07']
    ]);

    const preview = await upload(first, false);
    check('미리보기는 장부를 바꾸지 않는다', preview.preview && preview.added === 4 && (await db().collection('companytransactions').countDocuments()) === 0, `새 줄 ${preview.added}`);
    const applied = await upload(first, true);
    check('반영하면 4줄이 들어간다', applied.added === 4, applied.message);
    const again = await upload(first, true);
    check('같은 엑셀을 다시 올려도 줄이 늘지 않는다', again.added === 0 && again.kept === 4 && (await db().collection('companytransactions').countDocuments()) === 4);

    const sum = await api('GET', '/api/company-book/summary');
    const amountOf = (account, year) => sum.rows.filter((r) => r.account === account && (!year || r.year === year)).reduce((s, r) => s + (r.direction === '출금' ? r.amount : -r.amount), 0);
    check('입찰 보증금은 비용이 아니라 보증금으로 잡힌다(맡김 5,500만 − 환급 2,000만)', amountOf('deposit') === 35000000, String(amountOf('deposit')));
    check('2025년 급여 합계 610만 원', amountOf('salary', 2025) === 6100000, String(amountOf('salary', 2025)));

    // 화면에서 2월 급여를 4대보험 계정으로 옮긴다(시험용)
    const list = await api('GET', '/api/company-book/transactions?year=2025&account=salary');
    const feb = list.items.find((t) => t.description === '2025-2월 급여');
    await api('PUT', `/api/company-book/transactions/${feb._id}`, { account: 'payroll' });
    await api('DELETE', `/api/company-book/transactions/${feb._id}`, null, { expect: [400] });
    check('엑셀에서 온 줄은 지울 수 없다(다시 올리면 되살아나므로)', true);

    // 자금팀이 1월 급여 금액을 고치고 3월 줄을 더한 엑셀
    const fixed = book([
      ['2025-1월 급여', 3050000, '2025-01-25', '미군부대 입찰 수수료', 55000000, '2024-11-06'],
      ['2025-2월 급여', 3100000, '2025-02-25', '미군부대 입찰 1차 환급', -20000000, '2025-07-07'],
      ['2025-3월 급여', 3100000, '2025-03-25', '', '', '']
    ]);
    const re = await upload(fixed, true);
    check('고친 엑셀: 새 줄 2(고친 1월 + 3월), 지운 줄 1(옛 1월)', re.added === 2 && re.removed === 1, re.message);
    const after = await db().collection('companytransactions').findOne({ description: '2025-2월 급여' });
    check('화면에서 바꾼 계정은 다시 올려도 그대로다', after?.account === 'payroll' && after?.accountEdited === true, after?.account);

    const manual = await api('POST', '/api/company-book/transactions', { date: '2025-04-30', direction: '출금', amount: 4620000, account: 'rent', description: '4월 임대료' }, { expect: [201] });
    await upload(fixed, true);
    check('직접 적은 줄은 엑셀을 다시 올려도 남는다', Boolean(await db().collection('companytransactions').findOne({ _id: oid(manual.item._id) })));
    check('활동 기록 "회사 장부 수정"이 남았다', Boolean(await findActivity('회사 장부 수정')));
    await mongoose.connection.collection('users').updateOne({ email: 'flowcheck@rentbenefit.test' }, { $set: { role: 'editor' } });
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
