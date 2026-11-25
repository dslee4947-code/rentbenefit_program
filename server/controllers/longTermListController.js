import XLSX from 'xlsx';
import Vehicle from '../models/Vehicle.js';
// populate가 찾을 수 있게 등록만 해 둔다
import '../models/Contract.js';
import '../models/Company.js';
import '../models/Customer.js';
import { kstYmd } from './deliveryDocsController.js';
import { vehicleEndOf, lastDayOf } from '../utils/contractTerm.js';
import { stripHonorific } from '../utils/personName.js';
import { sortLongTermList, parseLongTermSheet } from '../../shared/longTermList.js';

/**
 * 차고지 감면 공문에 붙이는 장기렌트 차량 명세 (대표님 2026-11-25).
 * 렌트차량 DB에서 뽑거나, 손으로 정리한 엑셀(3차_장기렌트_차량명세_계약자별 양식)을 읽는다.
 */
const BIZ_NO = /^\d{3}-?\d{2}-?\d{5}$/;

export const getLongTermList = async (req, res) => {
  try {
    const vehicles = await Vehicle.find({ status: { $in: ['장기렌트', '단기렌트'] }, plateNo: { $nin: [null, ''] } })
      .populate('company', 'name bizNo')
      .populate({ path: 'contract', populate: [{ path: 'companyId', select: 'name bizNo' }, { path: 'customer', select: 'name bizNo' }] })
      .lean();
    const rows = vehicles.map((v) => {
      const base = { plateNo: v.plateNo.replace(/\s+/g, ''), vin: v.vin || '', model: v.carModel || '' };
      if (v.status === '단기렌트') return { ...base, short: true, party: '단기렌트 (사고대차)', bizNo: '', contractNo: '', start: '', end: '', months: null, fee: null };
      const c = v.contract;
      const company = c?.companyId || v.company;
      const biz = String(company?.bizNo || c?.customer?.bizNo || '').trim();
      return {
        ...base,
        short: false,
        party: company?.name || stripHonorific(c?.customer?.name || v.contractorName || c?.leaseCompany || ''),
        bizNo: BIZ_NO.test(biz) ? biz : '',
        contractNo: c?.contractNo || '',
        start: kstYmd(v.deliveryDate || c?.deliveryDate),
        end: c ? kstYmd(lastDayOf(vehicleEndOf(c, v) || c.endDate)) : '',
        months: Number(c?.termMonths) || Number(v.paymentTerm) || null,
        fee: Number(v.monthlyFee) || null
      };
    });
    res.json({ success: true, rows: sortLongTermList(rows) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const importLongTermList = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: '엑셀 파일을 골라 주세요.' });
    const wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
    for (const name of wb.SheetNames) {
      const rows = parseLongTermSheet(XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' }));
      if (rows.length) return res.json({ success: true, rows });
    }
    res.status(400).json({ success: false, message: '차량번호·차대번호·차종·계약자 칸이 있는 표를 찾지 못했습니다.' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};
