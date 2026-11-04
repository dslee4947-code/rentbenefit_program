import Contract from '../models/Contract.js';
import Vehicle from '../models/Vehicle.js';
import VehicleLedger from '../models/VehicleLedger.js';
import BillingSchedule from '../models/BillingSchedule.js';
// populate가 찾을 수 있게 등록만 해 둔다
import '../models/Company.js';
import '../models/Customer.js';
import { saveDocument } from '../utils/documentStorageService.js';
import { sendEndDocMail } from '../utils/mailService.js';
import { noticeItemOf } from '../utils/depositNotice.js';
import { stripHonorific } from '../utils/personName.js';
import { kstYmd } from './deliveryDocsController.js';

/**
 * 보증금·선수금 안내문 (계약·출고 > 보증금·선수금 안내, 대표님 2026-11-04).
 *
 * 양식은 전자계약서 엑셀의 '보증금 안내문' 시트다. 그동안 계약서 폴더에 PDF로 만들어 보내던 것을
 * 목록에서 버튼 하나로 고객 청구 메일로 보낸다. 담당자가 버튼을 눌렀을 때만 나가고, 자동으로 보내는 길은 없다.
 */

const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());

/** 계약들의 목록 줄을 한 번에 만든다. 계약마다 따로 읽으면 70건이 넘어 화면이 늦다 */
const noticeItems = async (contracts) => {
  const ids = contracts.map((c) => c._id);
  const [vehicles, schedules] = await Promise.all([
    Vehicle.find({ $or: [{ _id: { $in: contracts.flatMap((c) => c.vehicles || []) } }, { contract: { $in: ids } }] })
      .select('contract plateNo carModel carSpec deposit advancePayment code').sort({ code: 1 }).lean(),
    BillingSchedule.find({ contract: { $in: ids } }).select('contract billingEmail').lean()
  ]);
  const ledgers = await VehicleLedger.find({ vehicle: { $in: vehicles.map((v) => v._id) } }).select('vehicle entries.side entries.category entries.amount').lean();
  return contracts.map((c) => {
    const linked = (c.vehicles || []).map(String);
    // 계약사실 증명원과 같은 기준: 계약에 묶인 차가 있으면 그 차, 없으면 차에 적힌 계약으로 찾는다
    const mine = vehicles.filter((v) => (linked.length ? linked.includes(String(v._id)) : String(v.contract) === String(c._id)));
    const myIds = mine.map((v) => String(v._id));
    const billingEmail = schedules.find((s) => String(s.contract) === String(c._id))?.billingEmail;
    return noticeItemOf({
      contract: c,
      vehicles: mine,
      ledgers: ledgers.filter((l) => myIds.includes(String(l.vehicle))),
      partyName: c.companyId?.name || stripHonorific(c.customer?.name || c.leaseCompany || ''),
      to: billingEmail || c.companyId?.billingEmail || c.customer?.email || ''
    });
  });
};

const CONTRACT_FIELDS = 'contractNo status contractDate pricing.deposit pricing.advancePayment vehicles companyId customer leaseCompany depositNotices docFolderName';
const withParty = (query) => query.select(CONTRACT_FIELDS).populate('companyId', 'name billingEmail').populate('customer', 'name email').lean();

/**
 * 보증금이나 선수금이 있는 진행 중 계약. 계약일이 최근인 것부터.
 * @route GET /api/delivery-docs/deposit-notices
 */
export const getDepositNotices = async (req, res) => {
  try {
    const contracts = await withParty(Contract.find({ status: { $nin: ['임시저장', '종료'] } }).sort({ contractDate: -1 }));
    const items = (await noticeItems(contracts)).filter((x) => x.deposit > 0 || x.advancePayment > 0);
    res.json({ success: true, items });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 안내문을 고객에게 메일로 보내고 계약서 폴더에도 저장한다.
 * 화면을 연 뒤 금액이 바뀌었으면 PDF와 달라지므로 보내지 않는다. 이미 보낸 계약은 force 없이는 다시 보내지 않는다.
 * @route POST /api/delivery-docs/:contractId/deposit-notice/send (multipart: file, to, deposit, advancePayment, force?)
 */
export const sendDepositNotice = async (req, res) => {
  try {
    const contract = await withParty(Contract.findById(req.params.contractId));
    if (!contract) return res.status(404).json({ success: false, message: '계약을 찾을 수 없습니다.' });
    if (!req.file) return res.status(400).json({ success: false, message: 'PDF가 없습니다.' });
    const [item] = await noticeItems([contract]);
    if (!item.label) return res.status(400).json({ success: false, message: '이 계약에는 보증금·선수금이 없습니다.' });
    if (Number(req.body.deposit) !== item.deposit || Number(req.body.advancePayment) !== item.advancePayment) {
      return res.status(409).json({ success: false, message: '화면을 연 뒤 금액이 바뀌었습니다. 새로고침 후 다시 보내 주세요.' });
    }
    const to = String(req.body.to || item.to || '').trim();
    if (!isEmail(to)) return res.status(400).json({ success: false, message: '받는 사람 이메일을 확인해 주세요.' });
    if (item.lastSent && req.body.force !== 'true') {
      return res.status(409).json({ success: false, alreadySent: true, message: `이미 ${kstYmd(item.lastSent.sentAt)}에 ${item.lastSent.sentTo}(으)로 보낸 기록이 있습니다.` });
    }
    const saved = await saveDocument({
      partyName: item.partyName,
      kind: 'contract',
      subFolder: contract.docFolderName || contract.contractNo,
      fileName: `${item.label}안내문_${item.partyName}_${contract.contractNo}_${kstYmd(new Date())}.pdf`,
      fileBuffer: req.file.buffer
    });
    await sendEndDocMail({
      to,
      templateKey: 'deposit-notice',
      fileName: saved.fileName,
      fileBuffer: req.file.buffer,
      values: {
        계약자: item.partyName,
        계약번호: contract.contractNo,
        구분: item.label,
        차량: item.vehicles.map((v) => [v.carModel, v.plateNo].filter(Boolean).join(' ')).join(', ') || '-'
      }
    });
    await Contract.updateOne({ _id: contract._id }, {
      $push: {
        depositNotices: {
          deposit: item.deposit,
          advancePayment: item.advancePayment,
          fileName: saved.fileName,
          savedPath: saved.localPath,
          sentAt: new Date(),
          sentTo: to,
          sentBy: req.user?.name || req.user?.email || ''
        }
      }
    });
    res.json({ success: true, message: `${item.partyName} ${item.label} 안내문을 ${to}(으)로 보내고 계약서 폴더에 저장했습니다.` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
