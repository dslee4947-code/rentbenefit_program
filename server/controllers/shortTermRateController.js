import Setting from '../models/Setting.js';
import Vehicle from '../models/Vehicle.js';
import { buildShortTermReport, shortTermRowFor, getInternalRate } from '../utils/shortTermReport.js';
import { getMaintenanceRates } from '../utils/maintenanceRates.js';
import { isPublicHoliday } from '../utils/koreanHolidays.js';
import {
  mergeRatePolicy, deriveRates, insurerGradeFor, insurerCcFor, rentalLifeFor, INSURER_RENTAL_TABLE, REGIONS
} from '../../shared/shortTermRates.js';

/**
 * 단기렌트 · 사고대차 단가표 (엑셀 "12. 단기 렌트비용.xls"를 옮긴 화면).
 *
 * 차 목록과 1개월 요금은 손익 원장의 단기렌트 장에서 온다(월 목표 = 견적 3년·인수가 30%·정비 포함, 차령 가감).
 * 렌트차량 DB 상태도 함께 본다: DB에서 단기렌트인 차는 원장이 없어도 넣고, 장기렌트·계약중·거래완료로 바뀐 차는 뺀다.
 * 화면을 열 때마다 새로 읽으므로 원장·DB에서 바꾸면 따로 손댈 것 없이 반영된다.
 * 1일·1주 요금, 주행거리·탁송 규칙, 차마다 직접 정한 요금, 대여 중 표시, 보험 담당자는 설정 한 칸(shortTermRateCard)에 둔다.
 */
const KEY = 'shortTermRateCard';

const loadCard = async () => {
  const doc = await Setting.findOne({ key: KEY }).lean();
  const value = doc?.value || {};
  return { value, updatedAt: doc?.updatedAt || null, updatedBy: doc?.updatedBy || '' };
};

// 계산기가 쓸 공휴일. 지난 30일부터 앞으로 1년.
const holidayList = () => {
  const out = [];
  const today = new Date();
  for (let i = -30; i <= 400; i += 1) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    if (isPublicHoliday(d)) out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  return out;
};

const money = (v) => (Number(v) > 0 ? Math.round(Number(v)) : null);

// 단가표 차 순서: 국산 → 수입, 브랜드는 기아 · 현대 · 제네시스 · 벤츠 · 그 밖의 수입차, 같은 브랜드 안에서는 싼 차부터(2026-10-28 대표님)
const BRAND_ORDER = [
  ['기아', /^(ray|레이|k\d|모닝|morning|스포티지|sportage|sorento|쏘렌토|카니발|carnival|셀토스|seltos|니로|niro|ev\d)/i],
  ['현대', /^(avante|아반떼|그랜저|grandeur|쏘나타|sonata|싼타페|santa|투싼|tucson|팰리세이드|palisade|아이오닉|ioniq|캐스퍼|casper|스타리아|staria|코나|kona)/i],
  ['제네시스', /^(g\d0|gv\d0)/i],
  ['벤츠', /^(maybach|마이바흐|amg|eq[a-z]|[ces]\d{3}|gl[a-z]?\s?\d{3}|cle|cla|g\s?\d{3})/i]
];
const brandRank = (carModel) => {
  const i = BRAND_ORDER.findIndex(([, re]) => re.test(String(carModel || '').trim()));
  return i === -1 ? BRAND_ORDER.length : i;
};
const brandName = (carModel) => BRAND_ORDER[brandRank(carModel)]?.[0] || '기타';

// 렌트차량 DB에서 이 상태면 단기렌트 단가표에서 뺀다(원장이 아직 단기렌트로 남아 있어도)
const NOT_SHORT_TERM = ['장기렌트', '계약중', '거래완료'];

/**
 * 단가표에 올릴 차. 단기렌트 원장 + 원장이 없는 DB 단기렌트 차.
 * 원장이 없는 차는 차 id를 원장 id 자리에 써서 차별 요금·대여 중 표시를 같은 방식으로 저장한다.
 */
const shortTermRows = async () => {
  const report = await buildShortTermReport();
  const [dbShortTerm, linked] = await Promise.all([
    Vehicle.find({ status: '단기렌트' })
      .select('carModel plateNo carPrice optionPrice discount deliveryFee cc fuelType maintenance status registrationDate deliveryDate').lean(),
    Vehicle.find({ _id: { $in: report.rows.map((r) => r.vehicleId).filter(Boolean) } }).select('status').lean()
  ]);
  const statusOf = new Map(linked.map((v) => [String(v._id), v.status]));
  const rows = report.rows.filter((r) => !NOT_SHORT_TERM.includes(statusOf.get(String(r.vehicleId))));
  const inReport = new Set(report.rows.map((r) => String(r.vehicleId)));
  const missing = dbShortTerm.filter((v) => !inReport.has(String(v._id)) && Number(v.carPrice) > 0);
  if (missing.length) {
    const [annualRate, maintenanceRates] = await Promise.all([getInternalRate(), getMaintenanceRates()]);
    for (const v of missing) {
      const row = shortTermRowFor({ _id: v._id, header: {}, entries: [], shortTerm: {} }, v, { annualRate, maintenanceRates });
      rows.push({ ...row, ledgerNo: null, reason: '손익 원장에 단기렌트 장이 없습니다 (렌트차량 DB 기준으로 올림)' });
    }
  }
  return rows;
};

/** @route GET /api/short-term-rates */
export const getShortTermRates = async (req, res) => {
  try {
    const [{ value, updatedAt, updatedBy }, rows] = await Promise.all([loadCard(), shortTermRows()]);
    const policy = mergeRatePolicy(value.policy);
    const overrides = value.vehicles || {};

    const cars = rows.map((r) => {
      const p = r.performance || {};
      const ov = overrides[String(r.ledgerId)] || {};
      // 1개월 = 이번 달 차령을 반영한 월 목표. 목표를 못 내는 차는 직접 정한 값만 쓴다.
      const calcMonth = p.currentTarget || r.calculatedTarget || 0;
      const base = deriveRates(ov.month || calcMonth, policy);
      // 보험사 등급: 직접 고른 등급 → 하이브리드는 같은 모델 내연기관 배기량 → 배기량
      const basis = insurerCcFor({ cc: r.cc, carModel: r.carModel, fuelType: r.fuelType });
      const grade = (ov.insurerGrade && INSURER_RENTAL_TABLE.find((g) => g.grade === ov.insurerGrade)) || insurerGradeFor(basis.cc);
      const life = rentalLifeFor({ cc: r.cc, ageStart: r.ageStart });
      return {
        ledgerId: r.ledgerId,
        ledgerNo: r.ledgerNo,
        vehicleId: r.vehicleId,
        carModel: r.carModel,
        brand: brandName(r.carModel),
        plateNo: r.plateNo,
        fuelType: r.fuelType,
        cc: r.cc,
        carPrice: r.carPrice,
        ageStart: r.ageStart,
        ageYear: p.ageYear || null,
        ageFactor: p.ageFactor || null,
        calculated: deriveRates(calcMonth, policy),
        rates: { day: ov.day || base.day, week: ov.week || base.week, month: base.month },
        overridden: { day: !!ov.day, week: !!ov.week, month: !!ov.month },
        renting: !!ov.renting,
        hidden: !!ov.hidden,
        note: ov.note || '',
        reason: r.reason,
        lastMonth: p.lastMonth ? { month: p.lastMonth.month, actual: p.lastMonth.actual, target: p.lastMonth.target, rate: p.lastMonth.rate } : null,
        insurer: grade ? { grade: grade.grade, size: grade.size, d1: grade.d1, d7: grade.d7, basis: ov.insurerGrade ? 'manual' : basis.basis } : null,
        // 렌터카 차령 만료일. 넘기면 대여사업에 쓸 수 없다(검사로 최대 2년 연장)
        rentalLife: life ? { years: life.years, until: life.until, daysLeft: Math.ceil((life.until - Date.now()) / 86400000) } : null
      };
    }).sort((a, b) => brandRank(a.carModel) - brandRank(b.carModel)
      || (a.carPrice || 0) - (b.carPrice || 0)
      || (a.rates.month || 0) - (b.rates.month || 0));

    res.json({
      success: true,
      policy,
      regions: REGIONS,
      cars,
      holidays: holidayList(),
      insurerTable: INSURER_RENTAL_TABLE.map((g) => ({ ...g, ccMax: Number.isFinite(g.ccMax) ? g.ccMax : null })),
      contacts: value.contacts || [],
      updatedAt,
      updatedBy
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 단가표 저장. 요금 규칙(policy)은 관리자만 바꾼다. 차별 요금·대여 중 표시·보험 담당자는 쓰기 권한이면 바꾼다.
 * @route PUT /api/short-term-rates
 */
export const updateShortTermRates = async (req, res) => {
  try {
    const { value } = await loadCard();
    const next = { ...value };

    if (req.body.policy) {
      if (req.user?.role !== 'admin') return res.status(403).json({ success: false, message: '요금 규칙은 관리자만 바꿀 수 있습니다.' });
      const merged = mergeRatePolicy(req.body.policy);
      if (!(merged.dayRatio > 0 && merged.dayRatio < 1)) return res.status(400).json({ success: false, message: '1일 비율은 0과 1 사이여야 합니다(예: 0.1).' });
      next.policy = merged;
    }

    if (req.body.vehicles && typeof req.body.vehicles === 'object') {
      const vehicles = { ...(value.vehicles || {}) };
      for (const [id, v] of Object.entries(req.body.vehicles)) {
        if (!/^[0-9a-f]{24}$/i.test(id) || !v || typeof v !== 'object') continue;
        vehicles[id] = {
          ...(vehicles[id] || {}),
          ...('day' in v ? { day: money(v.day) } : {}),
          ...('week' in v ? { week: money(v.week) } : {}),
          ...('month' in v ? { month: money(v.month) } : {}),
          ...('renting' in v ? { renting: !!v.renting } : {}),
          ...('hidden' in v ? { hidden: !!v.hidden } : {}),
          ...('note' in v ? { note: String(v.note || '').slice(0, 200) } : {}),
          ...('insurerGrade' in v ? { insurerGrade: /^[A-H]$/.test(v.insurerGrade || '') ? v.insurerGrade : null } : {})
        };
      }
      next.vehicles = vehicles;
    }

    if (Array.isArray(req.body.contacts)) {
      next.contacts = req.body.contacts
        .map((c) => ({
          shop: String(c.shop || '').trim(),
          insurer: String(c.insurer || '').trim(),
          name: String(c.name || '').trim(),
          phone: String(c.phone || '').trim(),
          note: String(c.note || '').trim()
        }))
        .filter((c) => c.shop || c.insurer || c.name || c.phone)
        .slice(0, 300);
    }

    await Setting.findOneAndUpdate(
      { key: KEY },
      { value: next, updatedBy: req.user?.name || req.user?.email || '' },
      { upsert: true, new: true }
    );
    res.json({ success: true, message: '단가표를 저장했습니다.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
