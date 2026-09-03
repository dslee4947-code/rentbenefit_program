import VehicleLedger, { summarizeLedger, pickLedgerCategory } from '../models/VehicleLedger.js';
import Vehicle from '../models/Vehicle.js';
import Contract from '../models/Contract.js';
import BillingSchedule from '../models/BillingSchedule.js';
import Company from '../models/Company.js';
import Customer from '../models/Customer.js';

/**
 * 갑지 번호를 채번한다. 차량 코드와 같은 체계(Ray-001, Grander-012)라
 * 엑셀에서 넘어온 번호와 눈으로 대조할 수 있다.
 *
 * 차량 코드가 이미 있으면 그걸 그대로 갑지 번호로 쓴다. 번호가 두 벌이면
 * "차량 DB의 Ray-003"과 "갑지의 Ray-007"이 같은 차인지 매번 확인해야 한다.
 */
const generateLedgerNo = async (carModel, vehicleCode) => {
  if (vehicleCode && !(await VehicleLedger.exists({ ledgerNo: vehicleCode }))) {
    return vehicleCode;
  }

  const base = (carModel || '').split(' ')[0].replace(/[^a-zA-Z가-힣0-9]/g, '') || 'VEH';
  const used = await VehicleLedger.find({ ledgerNo: new RegExp(`^${base}-`, 'i') })
    .select('ledgerNo').lean();
  const taken = new Set(used.map((d) => d.ledgerNo));

  let seq = used.length + 1;
  let candidate = `${base}-${String(seq).padStart(3, '0')}`;
  while (taken.has(candidate)) {
    seq += 1;
    candidate = `${base}-${String(seq).padStart(3, '0')}`;
  }
  return candidate;
};

/**
 * 차량·계약 문서에서 갑지 상단(header)과 고정 조건(terms)에 넣을 값을 뽑는다.
 *
 * 갑지에 이미 적혀 있는 값은 건드리지 않는다. 자금팀이 갑지 안에서 고친 값이
 * 차량 DB 값으로 되돌아가면 안 되기 때문이다(갑지 수정은 갑지 안에서만 산다).
 */
const buildSnapshot = (vehicle, contract, company, customer) => {
  const pricing = contract?.pricing || {};

  const header = {
    customerName: customer?.name || '',
    contractorName: company?.name || vehicle?.contractorName || customer?.name || '',
    carModel: vehicle?.carModel || contract?.vehicleInfo?.model || '',
    carSpec: vehicle?.carSpec || vehicle?.options || '',
    plateNo: vehicle?.plateNo || '',
    vin: vehicle?.vin || '',
    cc: vehicle?.cc,
    year: vehicle?.year || '',
    leaseCompany: contract?.leaseCompany || '',
    carPrice: vehicle?.carPrice ?? pricing.basePrice,
    registeredAt: vehicle?.registrationDate,
    contractedAt: contract?.contractDate,
    contractEndAt: contract?.endDate,
    deliveredAt: vehicle?.deliveryDate || contract?.deliveryDate
  };

  const terms = {
    monthlyRent: vehicle?.monthlyFee ?? pricing.monthlyFee,
    termMonths: contract?.termMonths ?? pricing.paymentTerm,
    deposit: vehicle?.deposit ?? pricing.deposit,
    advancePayment: vehicle?.advancePayment ?? pricing.advancePayment,
    takeoverPrice: vehicle?.takeoverPrice ?? pricing.takeoverPrice,
    rentStartDate: vehicle?.rentBillingDate,
    paymentDay: vehicle?.monthlyPaymentDay || (pricing.billingDay ? String(pricing.billingDay) : '')
  };

  const loan = vehicle?.loan?.executed
    ? {
        executed: true,
        lender: vehicle.loan.lender,
        executedDate: vehicle.loan.executedDate,
        amount: vehicle.loan.amount,
        termMonths: vehicle.loan.termMonths,
        monthlyPayment: vehicle.loan.monthlyPayment
      }
    : null;

  return { header, terms, loan };
};

/**
 * 렌트차량 DB의 상태를 갑지의 성격(ledgerType)과 진행 상태(status)로 옮긴다.
 *
 * 두 축을 나눠 둔 이유: "사고대차 차량인데 아직 운용중"과 "장기렌트인데 거래완료"가
 * 모두 성립한다. 하나로 합치면 사고대차 차가 끝났을 때 둘 중 하나를 버려야 한다.
 */
const resolveKind = (vehicle) => {
  const vs = vehicle?.status;
  return {
    ledgerType: vs === '사고대차' ? '사고대차' : '장기렌트',
    status: vs === '거래완료' ? '거래완료' : '운용중'
  };
};

// 빈 값만 채운다. 이미 적혀 있는 값은 자금팀이 손댄 것일 수 있어 덮어쓰지 않는다.
const fillBlanks = (target, source) => {
  Object.entries(source || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    const current = target[key];
    if (current === undefined || current === null || current === '') {
      target[key] = value;
    }
  });
};

/**
 * 이 갑지에 이미 있는 자동 생성 줄을 (구간, source, category, round)로 찾는다.
 * 회차가 없는 항목(계약금·보증금 등)은 round를 0으로 본다.
 *
 * 구간을 열쇠에 넣지 않으면, 연장 계약의 "렌트료 1회차"가 최초 계약의 1회차와
 * 같은 줄로 인식되어 서로를 덮어쓴다.
 */
const findAutoEntry = (ledger, periodSeq, source, category, round = 0) =>
  ledger.entries.find((e) =>
    (e.periodSeq || 1) === periodSeq
    && e.source === source && e.category === category && (e.round || 0) === round);

/**
 * 자동 연동 줄 하나를 반영한다.
 *
 * 이미 있으면 값만 갱신하되, locked(사람이 고친 줄)면 그대로 둔다.
 * 이 한 줄이 "자금팀 입력을 절대 덮어쓰지 않는다"는 약속의 전부다.
 */
const upsertAutoEntry = (ledger, draft) => {
  const existing = findAutoEntry(ledger, draft.periodSeq || 1, draft.source, draft.category, draft.round || 0);
  if (existing) {
    if (existing.locked) return false;
    existing.side = draft.side;
    existing.group = draft.group;
    existing.label = draft.label;
    existing.amount = draft.amount;
    if (draft.date) existing.date = draft.date;
    if (draft.bank && !existing.bank) existing.bank = draft.bank;
    existing.sourceRef = draft.sourceRef;
    return true;
  }
  ledger.entries.push({ ...draft, periodSeq: draft.periodSeq || 1, locked: false });
  return true;
};

/**
 * 이 갑지의 계약 구간 목록을 돌려준다.
 *
 * 연장 이력이 아직 없는 갑지(엑셀에서 옮겨 온 127장 포함)는 contractPeriods가 비어 있으므로
 * 지금 붙어 있는 계약과 terms로 1구간짜리 목록을 만들어 준다.
 * 그래야 아래 동기화 코드가 "구간이 하나뿐인 경우"를 따로 다루지 않아도 된다.
 */
const resolvePeriods = (ledger) => {
  if (ledger.contractPeriods?.length) {
    return [...ledger.contractPeriods].sort((a, b) => a.seq - b.seq);
  }
  return [{
    seq: 1,
    contract: ledger.contract,
    monthlyRent: ledger.terms?.monthlyRent,
    termMonths: ledger.terms?.termMonths,
    deposit: ledger.terms?.deposit,
    advancePayment: ledger.terms?.advancePayment,
    takeoverPrice: ledger.terms?.takeoverPrice
  }];
};

/**
 * 이미 시스템에 있는 값으로 갑지 줄을 만들어 둔다.
 *
 * 렌트료 입금 28회차를 자금팀이 한 줄씩 옮겨 적을 이유가 없다. 청구 회차표에
 * 입금완료로 찍힌 회차가 곧 갑지의 입금 줄이다. 나머지(과태료·통행료·주유비처럼
 * 시스템이 모르는 돈)만 사람이 적으면 된다.
 *
 * @returns {Promise<number>} 새로 만들거나 갱신한 줄 수
 */
export const syncLedgerEntries = async (ledger) => {
  let changed = 0;

  const vehicle = ledger.vehicle
    ? await Vehicle.findById(ledger.vehicle).lean()
    : null;

  const periods = resolvePeriods(ledger);
  const lastSeq = periods[periods.length - 1]?.seq;

  for (const period of periods) {
    const contract = period.contract ? await Contract.findById(period.contract).lean() : null;
    const pricing = contract?.pricing || {};
    const seq = period.seq || 1;
    const tag = seq > 1 ? ` (${seq - 1}차 연장)` : '';

    // 1. 계약에서 정해진 고정 금액
    //
    //    차량가는 최초 계약에서 차를 살 때 한 번만 나간다. 연장 구간에도 넣으면
    //    같은 차를 두 번 산 것이 되어 손익이 통째로 틀어진다.
    //    인수가는 반대로 차를 넘길 때 마지막 구간에서만 들어온다.
    const fixed = [
      seq === 1 && { side: '지출', group: '회사출금', category: '차량가', label: '차량가', amount: vehicle?.carPrice ?? pricing.basePrice, date: vehicle?.registrationDate || contract?.contractDate },
      { side: '입금', group: '고객입금', category: '보증금', label: `보증금${tag}`, amount: period.deposit ?? pricing.deposit, date: contract?.contractDate },
      { side: '입금', group: '고객입금', category: '선납금', label: `선납금${tag}`, amount: period.advancePayment ?? pricing.advancePayment, date: contract?.contractDate },
      seq === lastSeq && { side: '입금', group: '고객입금', category: '인수가', label: '인수가', amount: period.takeoverPrice ?? pricing.takeoverPrice, date: contract?.endDate }
    ].filter(Boolean);

    fixed.forEach((row) => {
      if (!row.amount) return;
      if (upsertAutoEntry(ledger, { ...row, round: 0, periodSeq: seq, source: 'contract', sourceRef: contract?._id })) changed += 1;
    });

    // 2. 렌트료 입금 - 그 구간의 청구 회차표에서 입금완료로 찍힌 회차만 가져온다.
    //
    //    청구서는 계약서 단위(한 계약에 차량 20대인 건이 있다)인데 갑지는 차량 1대 단위라,
    //    그 회차 입금액을 이 차량 몫으로 나눠 담는다. 나누는 기준은 월 렌트료 비율이고,
    //    연장하면서 렌트료가 바뀌므로 비율도 구간마다 다시 계산한다.
    if (!period.contract) continue;
    const schedule = await BillingSchedule.findOne({ contract: period.contract }).lean();
    if (!schedule) continue;

    const myRent = Number(period.monthlyRent) || 0;
    const totalRent = Number(schedule.monthlyRent) || 0;
    const share = (myRent > 0 && totalRent > 0) ? Math.min(myRent / totalRent, 1) : 1;

    (schedule.rounds || []).forEach((r) => {
      if (r.status !== '입금완료') return;
      const base = Number(r.paidAmount) || Number(r.total) || 0;
      if (!base) return;
      const amount = Math.round(base * share);
      if (!amount) return;

      if (upsertAutoEntry(ledger, {
        side: '입금',
        group: '고객입금',
        category: '렌트료',
        label: `렌트료 ${r.no}회차${tag}`,
        amount,
        date: r.paidAt || r.dueDate,
        round: r.no,
        periodSeq: seq,
        source: 'billing',
        sourceRef: schedule._id,
        memo: share < 1 ? `계약 전체 ${base.toLocaleString()}원 중 월 렌트료 비율로 안분` : undefined
      })) changed += 1;
    });
  }

  // 3. 차량에서 가져오는 지출 - 실제 가입한 보험료와 출고 전 작업(선팅·블랙박스 등)
  if (vehicle) {
    const premium = Number(vehicle.insuranceEnrollment?.premium) || 0;
    if (premium && vehicle.insuranceEnrollment?.enrolled) {
      if (upsertAutoEntry(ledger, {
        side: '지출', group: '회사출금', category: '보험', label: '보험 1회차',
        amount: premium, date: vehicle.insuranceEnrollment.startDate,
        round: 1, periodSeq: 1, source: 'vehicle', sourceRef: vehicle._id
      })) changed += 1;
    }

    (vehicle.vehicleWorks || []).forEach((w, i) => {
      const amount = Number(w.price) || 0;
      if (!amount) return;
      if (upsertAutoEntry(ledger, {
        side: '지출', group: '회사출금', category: '차량작업',
        label: w.vendor ? `${w.name || '차량작업'}-${w.vendor}` : (w.name || '차량작업'),
        amount, date: w.scheduledDate, round: i + 1, periodSeq: 1,
        source: 'vehicle', sourceRef: vehicle._id
      })) changed += 1;
    });
  }

  // 4. 회사 할부금 - 이미 지나간 회차만 만든다.
  //    남은 회차까지 미리 지출로 깔면 아직 나가지도 않은 돈이 정산금액에 섞인다.
  const loan = ledger.loan;
  if (loan?.executed && loan.monthlyPayment > 0 && loan.executedDate) {
    const start = new Date(loan.executedDate);
    const now = new Date();
    const elapsed = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
    const rounds = Math.max(0, Math.min(elapsed, Number(loan.termMonths) || 0));

    for (let i = 1; i <= rounds; i += 1) {
      const due = new Date(start);
      due.setMonth(due.getMonth() + i);
      if (upsertAutoEntry(ledger, {
        side: '지출', group: '회사출금', category: '할부금',
        label: `할부금 ${i}회차`, amount: Number(loan.monthlyPayment),
        date: due, round: i, periodSeq: 1, source: 'loan'
      })) changed += 1;
    }
  }

  return changed;
};

/** 목록/상세에 함께 내려 줄 집계를 붙인다. */
const withSummary = (doc) => {
  const obj = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return { ...obj, summary: summarizeLedger(obj) };
};

// @desc    갑지 목록 (검색·필터)
// @route   GET /api/ledgers
export const getLedgers = async (req, res) => {
  try {
    const { q, status, ledgerType, companyId, sort = 'createdAt', order = 'desc' } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (ledgerType) filter.ledgerType = ledgerType;
    if (companyId) filter.company = companyId;
    if (q && q.trim()) {
      const rx = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { ledgerNo: rx },
        { 'header.plateNo': rx },
        { 'header.vin': rx },
        { 'header.carModel': rx },
        { 'header.contractorName': rx },
        { 'header.customerName': rx }
      ];
    }

    const ledgers = (await VehicleLedger.find(filter)
      .populate('company', 'name bizNo')
      .lean()).map(withSummary);

    /**
     * 정렬은 DB가 아니라 여기서 한다.
     * 정산금액·누적지출·누적입금은 저장된 값이 아니라 줄을 합쳐 만든 값이라
     * Mongo가 정렬할 수 없다. 기준이 무엇이든 같은 자리에서 정렬해야
     * "계약자명으로 정렬" 과 "정산금액으로 정렬" 이 따로 놀지 않는다.
     */
    const pick = {
      ledgerNo: (l) => l.ledgerNo,
      contractorName: (l) => l.header?.contractorName || l.company?.name || '',
      customerName: (l) => l.header?.customerName || '',
      carModel: (l) => l.header?.carModel || '',
      plateNo: (l) => l.header?.plateNo || '',
      deliveredAt: (l) => (l.header?.deliveredAt ? new Date(l.header.deliveredAt).getTime() : null),
      contractEndAt: (l) => (l.header?.contractEndAt ? new Date(l.header.contractEndAt).getTime() : null),
      paidOut: (l) => l.summary.paidOut,
      paidIn: (l) => l.summary.paidIn,
      balance: (l) => l.summary.balance,
      createdAt: (l) => new Date(l.createdAt).getTime()
    }[sort] || ((l) => new Date(l.createdAt).getTime());

    const dir = order === 'asc' ? 1 : -1;
    // 값이 비어 있는 줄(계약자명 미입력, 출고일 미정)은 방향과 상관없이 항상 뒤로 보낸다.
    // 오름차순을 눌렀을 때 빈칸이 맨 위를 차지하면 정렬한 의미가 없다.
    const isBlank = (v) => v === '' || v === null || v === undefined;

    ledgers.sort((a, b) => {
      const av = pick(a);
      const bv = pick(b);
      if (isBlank(av) !== isBlank(bv)) return isBlank(av) ? 1 : -1;
      // 한글 이름은 사전순이 아니라 가나다순으로 정렬해야 사람이 찾을 수 있다
      if (typeof av === 'string' || typeof bv === 'string') {
        return String(av).localeCompare(String(bv), 'ko') * dir;
      }
      return (av - bv) * dir;
    });

    res.json(ledgers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    갑지 한 장
// @route   GET /api/ledgers/:id
export const getLedgerById = async (req, res) => {
  try {
    const ledger = await VehicleLedger.findById(req.params.id)
      .populate('company', 'name bizNo')
      .populate('customer', 'name surname givenName')
      .populate('vehicle', 'code carModel plateNo vin status')
      .populate('contract', 'contractNo status contractDate endDate');
    if (!ledger) return res.status(404).json({ message: '갑지를 찾을 수 없습니다.' });

    res.json(withSummary(ledger));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * 갑지 한 장을 만든다. 계약서 등록에서 자동으로도, 화면에서 수동으로도 이걸 쓴다.
 *
 * @param {object} opts vehicleId / contractId 없이 header만 줘도 만들어진다(차량 출고 전 계약금 기록용)
 */
export const createLedgerDoc = async ({ vehicleId, contractId, header = {}, terms = {}, note, sync = true }) => {
  const vehicle = vehicleId ? await Vehicle.findById(vehicleId).lean() : null;
  const contractId2 = contractId || vehicle?.contract || null;
  const contract = contractId2 ? await Contract.findById(contractId2).lean() : null;

  const companyId = contract?.companyId || vehicle?.company || null;
  const company = companyId ? await Company.findById(companyId).select('name').lean() : null;
  const customer = contract?.customer
    ? await Customer.findById(contract.customer).select('name surname givenName').lean()
    : null;

  const snapshot = buildSnapshot(vehicle, contract, company, customer);
  const finalHeader = { ...snapshot.header };
  Object.entries(header || {}).forEach(([k, v]) => { if (v !== undefined && v !== '') finalHeader[k] = v; });
  const finalTerms = { ...snapshot.terms };
  Object.entries(terms || {}).forEach(([k, v]) => { if (v !== undefined && v !== '') finalTerms[k] = v; });

  const ledgerNo = await generateLedgerNo(finalHeader.carModel, vehicle?.code);

  const ledger = new VehicleLedger({
    ledgerNo,
    vehicle: vehicle?._id || null,
    contract: contract?._id || null,
    company: companyId,
    customer: contract?.customer || null,
    ledgerType: vehicle ? resolveKind(vehicle).ledgerType : '장기렌트',
    status: vehicle ? resolveKind(vehicle).status : '차량미배정',
    header: finalHeader,
    terms: finalTerms,
    // 최초 계약이 곧 1구간이다. 연장하면 여기에 한 칸씩 붙는다.
    contractPeriods: contract ? [{
      seq: 1,
      contract: contract._id,
      contractNo: contract.contractNo,
      startDate: contract.contractDate,
      endDate: contract.endDate,
      termMonths: finalTerms.termMonths,
      monthlyRent: finalTerms.monthlyRent,
      deposit: finalTerms.deposit,
      advancePayment: finalTerms.advancePayment,
      takeoverPrice: finalTerms.takeoverPrice
    }] : [],
    loan: snapshot.loan || undefined,
    note
  });

  if (sync) await syncLedgerEntries(ledger);
  await ledger.save();
  return ledger;
};

// @desc    갑지 수동 생성
// @route   POST /api/ledgers
export const createLedger = async (req, res) => {
  try {
    const ledger = await createLedgerDoc({
      vehicleId: req.body.vehicleId || null,
      contractId: req.body.contractId || null,
      header: req.body.header,
      terms: req.body.terms,
      note: req.body.note
    });
    res.status(201).json(withSummary(ledger));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * 계약서 최종 등록에서 만들어진 차량마다 갑지를 한 장씩 만든다.
 * 갑지를 못 만들어도 계약 등록 자체는 막지 않는다(나중에 화면에서 만들 수 있다).
 */
export const createLedgersForVehicles = async (vehicles, contractId) => {
  const created = [];
  for (const v of vehicles) {
    try {
      if (await VehicleLedger.exists({ vehicle: v._id })) continue;
      created.push(await createLedgerDoc({ vehicleId: v._id, contractId, sync: false }));
    } catch (err) {
      console.log(`[차량 손익 원장] ${v.code || v._id}: 만들지 못했습니다 - ${err.message}`);
    }
  }
  return created;
};

// @desc    갑지 상단·고정조건·할부·상태 수정 (갑지 안에서만 유효하고 계약서로 되돌아가지 않는다)
// @route   PUT /api/ledgers/:id
export const updateLedger = async (req, res) => {
  try {
    const ledger = await VehicleLedger.findById(req.params.id);
    if (!ledger) return res.status(404).json({ message: '갑지를 찾을 수 없습니다.' });

    ['header', 'terms', 'loan'].forEach((key) => {
      if (req.body[key] && typeof req.body[key] === 'object') {
        Object.entries(req.body[key]).forEach(([k, v]) => { ledger[key][k] = v; });
      }
    });
    if (req.body.ledgerType !== undefined) ledger.ledgerType = req.body.ledgerType;
    if (req.body.status !== undefined) ledger.status = req.body.status;
    if (req.body.note !== undefined) ledger.note = req.body.note;

    await ledger.save();
    res.json(withSummary(ledger));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * 갑지 줄 전체를 저장한다. 화면이 표 하나를 통째로 들고 있으므로 통째로 받는다.
 *
 * 자동으로 만들어진 줄(source != manual)의 금액·날짜·은행·이름을 사람이 고치면
 * 그 줄에 locked를 켠다. 다음 동기화가 그 줄을 다시 덮어쓰지 않게 하려는 것이다.
 */
// @route   PUT /api/ledgers/:id/entries
export const saveLedgerEntries = async (req, res) => {
  try {
    const ledger = await VehicleLedger.findById(req.params.id);
    if (!ledger) return res.status(404).json({ message: '갑지를 찾을 수 없습니다.' });

    const incoming = Array.isArray(req.body.entries) ? req.body.entries : [];
    const before = new Map(ledger.entries.map((e) => [String(e._id), e]));

    const next = incoming.map((row) => {
      const prev = row._id ? before.get(String(row._id)) : null;
      const amount = Number(row.amount) || 0;

      if (!prev) {
        // 화면에서 새로 추가한 줄은 언제나 사람이 적은 줄이다.
        // 분류는 화면에서 고르지 않고 적어 넣은 이름에서 판정한다.
        return {
          side: row.side === '입금' ? '입금' : '지출',
          group: row.group || (row.side === '입금' ? '고객입금' : '회사출금'),
          category: pickLedgerCategory(row.label),
          label: row.label || '',
          amount,
          bank: row.bank || '',
          date: row.date || undefined,
          round: row.round || undefined,
          memo: row.memo || undefined,
          source: 'manual',
          locked: false
        };
      }

      const edited = prev.source !== 'manual' && (
        (Number(prev.amount) || 0) !== amount
        || (prev.label || '') !== (row.label || '')
        || (prev.bank || '') !== (row.bank || '')
        || (prev.category || '') !== (row.category || '')
        || String(prev.date || '') !== String(row.date ? new Date(row.date) : '')
      );

      // 사람이 적은 줄은 이름이 곧 분류의 근거다. 이름을 고치면 분류도 따라 바뀐다.
      const category = prev.source === 'manual'
        ? pickLedgerCategory(row.label ?? prev.label)
        : (row.category || prev.category);

      return {
        _id: prev._id,
        side: row.side === '입금' ? '입금' : '지출',
        group: row.group || prev.group,
        category,
        label: row.label ?? prev.label,
        amount,
        bank: row.bank ?? prev.bank,
        date: row.date || undefined,
        round: row.round ?? prev.round,
        memo: row.memo ?? prev.memo,
        source: prev.source,
        sourceRef: prev.sourceRef,
        locked: prev.locked || edited
      };
    });

    ledger.entries = next;
    await ledger.save();
    res.json(withSummary(ledger));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    자동 연동 다시 실행 (사람이 고친 줄은 그대로 둔다)
// @route   POST /api/ledgers/:id/sync
export const syncLedger = async (req, res) => {
  try {
    const ledger = await VehicleLedger.findById(req.params.id);
    if (!ledger) return res.status(404).json({ message: '갑지를 찾을 수 없습니다.' });

    const changed = await syncLedgerEntries(ledger);
    await ledger.save();

    res.json({ ...withSummary(ledger), syncedCount: changed });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    출고된 차량을 갑지에 연결한다 (차량미배정 상태로 먼저 만든 갑지용)
// @route   POST /api/ledgers/:id/link-vehicle
export const linkVehicle = async (req, res) => {
  try {
    const ledger = await VehicleLedger.findById(req.params.id);
    if (!ledger) return res.status(404).json({ message: '갑지를 찾을 수 없습니다.' });

    const vehicle = await Vehicle.findById(req.body.vehicleId).lean();
    if (!vehicle) return res.status(404).json({ message: '차량을 찾을 수 없습니다.' });

    const already = await VehicleLedger.findOne({ vehicle: vehicle._id, _id: { $ne: ledger._id } })
      .select('ledgerNo').lean();
    if (already) {
      return res.status(400).json({ message: `이 차량은 이미 갑지 ${already.ledgerNo}에 연결되어 있습니다.` });
    }

    const contract = vehicle.contract ? await Contract.findById(vehicle.contract).lean() : null;
    const companyId = contract?.companyId || vehicle.company || null;
    const company = companyId ? await Company.findById(companyId).select('name').lean() : null;
    const customer = contract?.customer
      ? await Customer.findById(contract.customer).select('name surname givenName').lean()
      : null;

    ledger.vehicle = vehicle._id;
    if (contract) ledger.contract = contract._id;
    if (companyId) ledger.company = companyId;
    if (contract?.customer) ledger.customer = contract.customer;
    // 사고대차 차량을 이어 붙였으면 갑지 성격도 그때 정해진다
    const kind = resolveKind(vehicle);
    ledger.ledgerType = kind.ledgerType;
    if (ledger.status === '차량미배정') ledger.status = kind.status;

    // 차량이 붙으면서 새로 알게 된 값만 채운다. 이미 적어 둔 값은 그대로 둔다.
    const snapshot = buildSnapshot(vehicle, contract, company, customer);
    fillBlanks(ledger.header, snapshot.header);
    fillBlanks(ledger.terms, snapshot.terms);
    if (snapshot.loan && !ledger.loan?.executed) ledger.loan = snapshot.loan;

    await syncLedgerEntries(ledger);
    await ledger.save();

    res.json(withSummary(ledger));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * 계약 연장을 이 갑지에 붙인다.
 *
 * 연장할 때 계약서를 새로 쓰기 때문에, 그대로 두면 렌트차량 DB에 차가 한 대 더 생기고
 * 계약 등록 훅이 갑지도 한 장 더 만든다. 같은 차의 갑지가 둘로 갈라지면
 * 원 갑지는 지출만 남아 적자로, 새 갑지는 렌트료만 쌓여 폭리로 보인다.
 * 그래서 새로 생긴 갑지를 흡수해 한 장으로 합친다.
 */
// @route   POST /api/ledgers/:id/extend
export const extendLedger = async (req, res) => {
  try {
    const ledger = await VehicleLedger.findById(req.params.id);
    if (!ledger) return res.status(404).json({ message: '갑지를 찾을 수 없습니다.' });

    const contract = await Contract.findById(req.body.contractId).lean();
    if (!contract) return res.status(404).json({ message: '연장 계약서를 찾을 수 없습니다.' });

    const periods = ledger.contractPeriods || [];
    if (periods.some((p) => String(p.contract) === String(contract._id))) {
      return res.status(400).json({ message: '이미 이 갑지에 등록된 계약입니다.' });
    }

    const seq = periods.length ? Math.max(...periods.map((p) => p.seq)) + 1 : 2;
    const pricing = contract.pricing || {};

    // 최초 계약 구간이 비어 있으면(연장 기능이 생기기 전에 만들어진 갑지) 먼저 채워 넣는다.
    // 그래야 1차 연장이 2구간으로 제자리를 잡는다.
    if (!periods.length) {
      ledger.contractPeriods.push({
        seq: 1,
        contract: ledger.contract,
        startDate: ledger.header?.contractedAt,
        endDate: ledger.header?.contractEndAt,
        termMonths: ledger.terms?.termMonths,
        monthlyRent: ledger.terms?.monthlyRent,
        deposit: ledger.terms?.deposit,
        advancePayment: ledger.terms?.advancePayment,
        takeoverPrice: ledger.terms?.takeoverPrice
      });
    }

    ledger.contractPeriods.push({
      seq,
      contract: contract._id,
      contractNo: contract.contractNo,
      startDate: contract.contractDate,
      endDate: contract.endDate,
      termMonths: contract.termMonths ?? pricing.paymentTerm,
      monthlyRent: pricing.monthlyFee ?? pricing.monthlyFeeTotal,
      deposit: pricing.deposit,
      advancePayment: pricing.advancePayment,
      takeoverPrice: pricing.takeoverPrice,
      note: req.body.note
    });

    /**
     * 연장 계약서를 등록할 때 자동으로 만들어진 갑지가 있으면 흡수한다.
     *
     * 찾는 조건을 좁게 잡는다. 계약 하나에 차량이 20대 묶인 건이 있어서
     * "이 계약을 가리키는 갑지"만으로 고르면 남의 차 갑지를 지울 수 있다. 장부에서 그건 복구가 안 된다.
     * 그래서 같은 차량번호이고, 사람이 아직 아무것도 적지 않은 갑지만 흡수 대상으로 본다.
     * 하나라도 어긋나면 흡수하지 않고 그대로 둔다 - 갑지가 하나 남는 건 지워지는 것보다 낫다.
     */
    const myPlate = (ledger.header?.plateNo || '').replace(/\s/g, '');
    const candidates = myPlate
      ? await VehicleLedger.find({ _id: { $ne: ledger._id }, contract: contract._id })
      : [];
    const duplicate = candidates.find((c) =>
      (c.header?.plateNo || '').replace(/\s/g, '') === myPlate
      && (c.contractPeriods?.length || 0) <= 1
      && !c.entries.some((e) => e.source === 'manual' || e.locked));
    let absorbed = 0;
    if (duplicate) {
      duplicate.entries.forEach((e) => {
        // 사람이 적은 줄만 가져온다.
        //
        // 자동으로 만들어진 줄은 아래 동기화가 이 갑지 기준으로 다시 만들어 준다.
        // 그대로 옮겨 오면 연장 계약서로 생성된 차량의 '차량가'가 딸려 와서
        // 같은 차를 두 번 산 것이 되고, 손익이 차량가만큼 통째로 틀어진다.
        if (e.source !== 'manual' && !e.locked) return;
        ledger.entries.push({ ...e.toObject(), _id: undefined, periodSeq: seq });
        absorbed += 1;
      });
      await duplicate.deleteOne();
    }

    // 지금 유효한 계약 조건은 연장 계약의 것이다
    ledger.contract = contract._id;
    ledger.terms.monthlyRent = pricing.monthlyFee ?? pricing.monthlyFeeTotal ?? ledger.terms.monthlyRent;
    ledger.terms.termMonths = contract.termMonths ?? ledger.terms.termMonths;
    if (pricing.deposit !== undefined) ledger.terms.deposit = pricing.deposit;
    if (pricing.advancePayment !== undefined) ledger.terms.advancePayment = pricing.advancePayment;
    if (pricing.takeoverPrice !== undefined) ledger.terms.takeoverPrice = pricing.takeoverPrice;
    ledger.header.contractEndAt = contract.endDate;
    if (ledger.status === '거래완료') ledger.status = '운용중';

    await syncLedgerEntries(ledger);
    await ledger.save();

    res.json({
      ...withSummary(ledger),
      absorbedLedger: duplicate ? duplicate.ledgerNo : null,
      absorbedEntries: absorbed
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    연장 계약으로 붙일 계약서 검색
// @route   GET /api/ledgers/contract-search?q=
export const searchContracts = async (req, res) => {
  try {
    const { q } = req.query;
    const filter = { status: { $nin: ['임시저장'] } };
    if (q && q.trim()) {
      const rx = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.contractNo = rx;
    }

    const contracts = await Contract.find(filter)
      .select('contractNo contractDate endDate termMonths pricing.monthlyFee companyId customer')
      .populate('companyId', 'name')
      .sort({ contractDate: -1 })
      .limit(30)
      .lean();

    res.json(contracts);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * 지금까지 적어 온 항목명 목록. 입력칸에서 "주"만 쳐도 "주유비"가 뜨게 하려는 것이다.
 *
 * 갑지 하나가 아니라 전체에서 모은다. 새로 만든 갑지에서도 첫 줄부터 자동완성이 되어야
 * "미납 통행료" / "미납통행료" / "미남통행료" 처럼 같은 항목이 이름만 달라지는 일이 줄어든다.
 */
// @route   GET /api/ledgers/labels
export const getLedgerLabels = async (req, res) => {
  try {
    const rows = await VehicleLedger.aggregate([
      { $unwind: '$entries' },
      { $match: { 'entries.label': { $nin: [null, ''] } } },
      { $group: { _id: { label: '$entries.label', group: '$entries.group' }, n: { $sum: 1 } } },
      { $sort: { n: -1 } },
      { $limit: 800 }
    ]);

    // 회차가 붙은 이름(렌트료 12회차, 보험 3회차)은 자동완성에 쓸모가 없어 뺀다.
    // 그런 줄은 회차마다 이름이 달라 목록만 수천 줄로 불어난다.
    const grouped = {};
    rows.forEach((r) => {
      const label = r._id.label;
      if (/\d+\s*회차/.test(label)) return;
      const group = r._id.group || '회사출금';
      if (!grouped[group]) grouped[group] = [];
      if (grouped[group].length < 150 && !grouped[group].includes(label)) grouped[group].push(label);
    });

    res.json(grouped);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    갑지 삭제
// @route   DELETE /api/ledgers/:id
export const deleteLedger = async (req, res) => {
  try {
    const ledger = await VehicleLedger.findById(req.params.id);
    if (!ledger) return res.status(404).json({ message: '갑지를 찾을 수 없습니다.' });
    await ledger.deleteOne();
    res.json({ message: `갑지 ${ledger.ledgerNo}를 삭제했습니다.` });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    갑지에 연결할 수 있는 차량 검색 (아직 갑지가 없는 차량만)
// @route   GET /api/ledgers/linkable-vehicles?q=
export const getLinkableVehicles = async (req, res) => {
  try {
    const { q } = req.query;
    const filter = {};
    if (q && q.trim()) {
      const rx = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ code: rx }, { plateNo: rx }, { vin: rx }, { carModel: rx }];
    }

    const linked = await VehicleLedger.find({ vehicle: { $ne: null } }).select('vehicle').lean();
    filter._id = { $nin: linked.map((l) => l.vehicle) };

    const vehicles = await Vehicle.find(filter)
      .select('code carModel carSpec plateNo vin year status')
      .sort({ createdAt: -1 })
      .limit(30)
      .lean();

    res.json(vehicles);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
