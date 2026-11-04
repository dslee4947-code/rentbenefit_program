import Contract from '../models/Contract.js';
import Vehicle from '../models/Vehicle.js';
import Company from '../models/Company.js';
import Customer from '../models/Customer.js';
import BillingSchedule from '../models/BillingSchedule.js';
import { nextCustomerId } from './vehicleController.js';
import { SHORT_TERM, buildShortTermSchedule } from '../utils/shortTermBilling.js';
import { logActivity, ACTIONS } from '../utils/activityLog.js';

/**
 * 단기렌트 월 청구 등록·반납. 청구서 발행·발송·입금은 장기렌트 청구서 화면에서 한다(utils/shortTermBilling.js).
 */

const badRequest = (res, message, status = 400) => res.status(status).json({ success: false, message });
const kstDate = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? new Date(`${s}T12:00:00+09:00`) : null);
const yymmdd = (d) => new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(2, 10).replace(/-/g, '');

/** @route GET /api/short-term-billing  단기렌트 계약 목록 + 고를 수 있는 단기렌트 차량 */
export const listShortTerm = async (req, res) => {
  try {
    const contracts = await Contract.find({ rentalKind: SHORT_TERM })
      .select('contractNo status rentStartDate returnDate pricing.monthlyFee pricing.billingDay companyId customer leaseCompany vehicle vehicles')
      .populate('companyId', 'name billingEmail')
      .populate('customer', 'name email')
      .populate('vehicle', 'code carModel plateNo')
      .sort({ status: 1, rentStartDate: -1 })
      .lean();
    const schedules = await BillingSchedule.find({ contract: { $in: contracts.map((c) => c._id) } })
      .select('contract billingEmail rounds.no rounds.dueDate rounds.total rounds.status rounds.paidAmount rounds.issuedAt')
      .lean();
    const byContract = new Map(schedules.map((s) => [String(s.contract), s]));
    const items = contracts.map((c) => {
      const s = byContract.get(String(c._id));
      const rounds = s?.rounds || [];
      return {
        ...c,
        scheduleId: s?._id || null,
        billingEmail: s?.billingEmail || c.companyId?.billingEmail || c.customer?.email || '',
        rounds: rounds.map((r) => ({ no: r.no, dueDate: r.dueDate, total: r.total, status: r.status, paidAmount: r.paidAmount, issued: Boolean(r.issuedAt) })),
        unpaid: rounds.filter((r) => r.status === '미납').reduce((n, r) => n + Math.max(0, (r.total || 0) - (r.paidAmount || 0)), 0)
      };
    });
    // 단기렌트 차량(대차 차량). 이미 다른 단기렌트 계약에 나가 있는 차는 표시만 한다
    const busy = new Map(contracts.filter((c) => c.status === '진행중').map((c) => [String(c.vehicle?._id || c.vehicle), c]));
    const vehicles = (await Vehicle.find({ status: '단기렌트' }).select('code carModel plateNo').sort({ code: 1 }).lean())
      .map((v) => ({ ...v, rentedTo: busy.get(String(v._id))?.companyId?.name || busy.get(String(v._id))?.customer?.name || '' }));
    res.json({ success: true, items, vehicles });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 단기렌트 월 청구를 등록한다. 계약(단기렌트)과 청구 회차표가 생기고, 장기렌트 청구서 화면에 그 달 회차가 뜬다.
 * @route POST /api/short-term-billing  { companyId | customerId, vehicleId, startDate, monthlyFee, billingDay, billingEmail }
 */
export const createShortTerm = async (req, res) => {
  try {
    const { companyId, customerId, vehicleId, billingEmail } = req.body;
    const start = kstDate(req.body.startDate);
    const monthlyFee = Math.round(Number(req.body.monthlyFee) || 0);
    if (!companyId && !customerId) return badRequest(res, '법인 또는 고객을 골라 주세요.');
    if (!vehicleId) return badRequest(res, '차량을 골라 주세요.');
    if (!start) return badRequest(res, '대여 시작일을 YYYY-MM-DD로 넣어 주세요.');
    if (monthlyFee <= 0) return badRequest(res, '월 대여료를 넣어 주세요.');
    const billingDay = Math.round(Number(req.body.billingDay) || 0); // 없으면 대여 시작일과 같은 날
    if (billingDay < 0 || billingDay > 31) return badRequest(res, '결제일을 확인해 주세요.');

    const vehicle = await Vehicle.findById(vehicleId);
    if (!vehicle) return badRequest(res, '차량을 찾을 수 없습니다.', 404);
    const running = await Contract.findOne({ rentalKind: SHORT_TERM, status: '진행중', vehicle: vehicle._id }).select('contractNo leaseCompany').lean();
    if (running) return badRequest(res, `${vehicle.plateNo} 차는 ${running.leaseCompany} 단기렌트(${running.contractNo})가 진행 중입니다. 먼저 반납 처리해 주세요.`, 409);
    if (vehicle.contract) {
      const cur = await Contract.findById(vehicle.contract).select('status rentalKind contractNo').lean();
      if (cur && cur.status === '진행중' && cur.rentalKind !== SHORT_TERM) {
        return badRequest(res, `${vehicle.plateNo} 차는 장기렌트 계약(${cur.contractNo})이 진행 중입니다.`, 409);
      }
    }

    const company = companyId ? await Company.findById(companyId).lean() : null;
    if (companyId && !company) return badRequest(res, '법인을 찾을 수 없습니다.', 404);
    // 계약에는 고객(Customer)이 꼭 있어야 한다. 법인은 그 법인의 기존 계약 고객을 쓰고, 없으면 법인 이름으로 만든다
    let customer = customerId ? await Customer.findById(customerId).lean() : null;
    if (!customer && company) {
      const prev = await Contract.findOne({ companyId: company._id, customer: { $ne: null } }).sort({ contractDate: -1 }).select('customer').lean();
      customer = prev ? await Customer.findById(prev.customer).lean() : await Customer.findOne({ name: company.name }).lean();
      if (!customer) {
        customer = (await Customer.create({ customerId: await nextCustomerId(), name: company.name, ...(company.bizNo ? { bizNo: company.bizNo } : {}), source: 'manual' })).toObject();
      }
    }
    if (!customer) return badRequest(res, '고객을 찾을 수 없습니다.', 404);

    const partyName = company?.name || customer.name;
    const base = `단기-${yymmdd(start)}-${String(vehicle.plateNo || vehicle.code || '').slice(-4)}`;
    let contractNo = base;
    for (let i = 2; await Contract.exists({ contractNo }); i += 1) contractNo = `${base}-${i}`;

    const contract = await Contract.create({
      contractNo,
      rentalKind: SHORT_TERM,
      partyType: company ? '법인' : '일반개인',
      companyId: company?._id,
      customer: customer._id,
      leaseCompany: partyName,
      contractDate: start,
      deliveryDate: start,
      rentStartDate: start,
      vehicle: vehicle._id,
      vehicles: [vehicle._id],
      pricing: { monthlyFee, ...(billingDay ? { billingDay } : {}) },
      status: '진행중',
    });
    // 청구서 차량 표는 이 계약에 묶인 차를 찾는다. 차 상태(단기렌트)와 원장 형태는 그대로 둔다
    vehicle.contract = contract._id;
    await vehicle.save();

    const schedule = await buildShortTermSchedule(contract.toObject());
    const to = String(billingEmail || company?.billingEmail || customer.email || '').trim();
    if (to) { schedule.billingEmail = to; await schedule.save(); }

    logActivity({
      req, dept: '재무부', action: ACTIONS.CONTRACT_CREATE, target: { model: 'Contract', id: contract._id },
      summary: `단기렌트 월 청구 등록 ${partyName} · ${vehicle.plateNo} · ${req.body.startDate}부터 월 ${monthlyFee.toLocaleString()}원 (${contractNo})`
    });
    res.json({ success: true, contractId: contract._id, contractNo, rounds: schedule.rounds.length, message: `${partyName} ${vehicle.plateNo} 단기렌트 월 청구를 등록했습니다. ${schedule.rounds.length}회차까지 만들었습니다.` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 월 대여료·청구 이메일을 고친다. 아직 청구서를 만들지 않은 회차에만 새 금액이 들어간다.
 * @route PATCH /api/short-term-billing/:id  { monthlyFee, billingEmail }
 */
export const updateShortTerm = async (req, res) => {
  try {
    const contract = await Contract.findOne({ _id: req.params.id, rentalKind: SHORT_TERM });
    if (!contract) return badRequest(res, '단기렌트 계약을 찾을 수 없습니다.', 404);
    const monthlyFee = req.body.monthlyFee !== undefined ? Math.round(Number(req.body.monthlyFee) || 0) : null;
    if (monthlyFee !== null) {
      if (monthlyFee <= 0) return badRequest(res, '월 대여료를 넣어 주세요.');
      contract.pricing = { ...(contract.pricing?.toObject?.() || contract.pricing || {}), monthlyFee };
      await contract.save();
      const s = await BillingSchedule.findOne({ contract: contract._id });
      if (s) {
        s.rounds.forEach((r) => { if (r.status === '예정' && !r.issuedAt && !r.note) { r.monthlyRent = monthlyFee; r.total = monthlyFee; } });
        await s.save();
      }
    }
    const schedule = await buildShortTermSchedule(contract.toObject());
    if (req.body.billingEmail !== undefined) { schedule.billingEmail = String(req.body.billingEmail || '').trim(); await schedule.save(); }
    res.json({ success: true, message: '고쳤습니다. 이미 만든 청구서 회차의 금액은 그대로입니다.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 반납. 반납일까지 일할로 마지막 회차를 맞추고 계약을 끝낸다.
 * @route POST /api/short-term-billing/:id/return  { returnDate }
 */
export const returnShortTerm = async (req, res) => {
  try {
    const contract = await Contract.findOne({ _id: req.params.id, rentalKind: SHORT_TERM });
    if (!contract) return badRequest(res, '단기렌트 계약을 찾을 수 없습니다.', 404);
    const day = kstDate(req.body.returnDate);
    if (!day) return badRequest(res, '반납일을 YYYY-MM-DD로 넣어 주세요.');
    if (day <= contract.rentStartDate) return badRequest(res, '반납일이 대여 시작일보다 빠릅니다.');
    contract.returnDate = day;
    const schedule = await buildShortTermSchedule(contract.toObject());
    contract.status = '종료';
    contract.endReason = '반납';
    contract.actualEndDate = day;
    await contract.save();
    const last = schedule.rounds[schedule.rounds.length - 1];
    logActivity({
      req, dept: '재무부', action: ACTIONS.CONTRACT_RETURN, target: { model: 'Contract', id: contract._id },
      summary: `단기렌트 반납 ${contract.leaseCompany} (${contract.contractNo}) ${req.body.returnDate}`
    });
    res.json({ success: true, message: `반납 처리했습니다. 마지막 ${last?.no || '-'}회차 ${Number(last?.total || 0).toLocaleString()}원${last?.note ? ` (${last.note})` : ''}` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
