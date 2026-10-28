import Contract from '../models/Contract.js';
import Vehicle from '../models/Vehicle.js';
import BillingSchedule from '../models/BillingSchedule.js';
import VehicleLedger, { saleEntryOf, hasSaleEntry, SALE_ENTRY_MEMO } from '../models/VehicleLedger.js';
import { closeContract } from './contractLifecycleController.js';
import { syncVehicleServiceSchedules } from '../utils/vehicleServiceScheduleJob.js';
import { logActivity, ACTIONS } from '../utils/activityLog.js';

/**
 * 차량 판매. 갑지 맨 위 '판매 대금' 칸에 넣으면 한 번에 끝낸다(대표님 2026-10-28).
 *
 * 그전에는 엑셀 갑지를 '판매완료' 파일로 옮겨도 갑지만 거래완료가 되고 차는 운행 중으로 남아
 * 검사·정비 알림이 계속 떴다(125호3204). 판매는 원장에 판매 대금이 들어오는 순간이 기준이라 여기서 처리한다.
 *
 *   - 갑지: 판매 대금 줄(인수가 항목) + 거래완료
 *   - 차량: 거래완료 → 검사 조회·정비 목록·정비 일정에서 빠진다
 *   - 계약: 이 차가 계약의 마지막 운행 차면 종료(인수/매각), 판매일 뒤 미청구 회차 정리
 *
 * [판매 취소]로 되돌릴 수 있게 바꾸기 전 값을 sale.undo에 남긴다.
 */

const OPEN_CONTRACT = ['진행중', '보관됨'];

// 갑지 줄 날짜는 UTC 자정으로 저장한다(화면이 toISOString 앞 10자리로 읽는다)
const parseYmd = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? new Date(v) : null);
const currentSeqOf = (ledger) => (ledger.contractPeriods?.length ? Math.max(...ledger.contractPeriods.map((p) => p.seq)) : 1);
const userNameOf = (req) => req.user?.name || '';

// @desc    판매 대금 넣기 → 차·계약·갑지 거래완료
// @route   POST /api/ledgers/:id/sale   body: { kind: '인수'|'매각', date: 'YYYY-MM-DD', amount, buyer, memo }
export const recordSale = async (req, res) => {
  try {
    const ledger = await VehicleLedger.findById(req.params.id);
    if (!ledger) return res.status(404).json({ success: false, message: '갑지를 찾을 수 없습니다.' });
    if (ledger.sale?.at) return res.status(400).json({ success: false, message: '이미 판매 처리한 갑지입니다.' });

    const kind = req.body.kind === '매각' ? '매각' : '인수';
    const date = parseYmd(req.body.date);
    const amount = Math.round(Number(String(req.body.amount ?? '').replace(/[^\d.-]/g, '')) || 0);
    const buyer = String(req.body.buyer || '').trim();
    const memo = String(req.body.memo || '').trim();
    if (!date) return res.status(400).json({ success: false, message: '판매일을 넣어 주세요.' });
    if (!(amount > 0)) return res.status(400).json({ success: false, message: '판매 대금을 넣어 주세요.' });
    if (kind === '매각' && !buyer) return res.status(400).json({ success: false, message: '매각한 곳을 넣어 주세요.' });

    const sale = { kind, date, amount, buyer, memo, by: userNameOf(req), at: new Date() };
    const undo = { ledgerStatus: ledger.status, removedEntries: [] };
    const notes = [];

    // 1. 갑지 판매 대금 줄. 엑셀에서 이미 같은 금액 줄이 들어와 있으면 그 줄을 쓴다.
    if (!hasSaleEntry(ledger.entries, amount)) {
      // 계약에서 자동으로 만든 '예정' 인수가 줄은 실제 판매 대금으로 바뀌므로 뺀다(두 번 잡히지 않게)
      const planned = ledger.entries.filter((e) => e.source === 'contract' && e.category === '인수가' && !e.locked);
      undo.removedEntries = planned.map((e) => e.toObject());
      ledger.entries = ledger.entries.filter((e) => !planned.includes(e));
      ledger.entries.push(saleEntryOf(sale, currentSeqOf(ledger)));
      undo.entryAdded = true;
    }
    ledger.status = '거래완료';

    // 2. 차량
    const vehicle = ledger.vehicle ? await Vehicle.findById(ledger.vehicle) : null;
    if (vehicle) {
      undo.vehicleStatus = vehicle.status;
      vehicle.status = '거래완료';
      await vehicle.save();
    } else {
      notes.push('연결된 차량이 없어 갑지만 거래완료로 했습니다.');
    }

    // 3. 계약. 한 계약에 차가 여러 대면 나머지가 다 끝났을 때만 닫는다.
    const contractId = ledger.contract || vehicle?.contract;
    const contract = contractId ? await Contract.findById(contractId) : null;
    if (contract && OPEN_CONTRACT.includes(contract.status)) {
      const others = await Vehicle.countDocuments({ contract: contract._id, _id: { $ne: vehicle?._id }, status: { $ne: '거래완료' } });
      if (others) {
        notes.push(`계약 ${contract.contractNo}에 운행 중인 차가 ${others}대 남아 계약은 그대로 둡니다. 렌트료 조정은 계약 화면에서 해 주세요.`);
      } else {
        const schedule = await BillingSchedule.findOne({ contract: contract._id }).lean();
        undo.contract = {
          id: contract._id,
          status: contract.status,
          endReason: contract.endReason || null,
          actualEndDate: contract.actualEndDate || null,
          rounds: schedule?.rounds || null,
          totalRounds: schedule?.totalRounds ?? null
        };
        const dropped = await closeContract(contract, kind, date);
        notes.push(`계약 ${contract.contractNo}을 종료(${kind})했습니다.${dropped ? ` 판매일 뒤 미청구 ${dropped}회차를 정리했습니다.` : ''}`);
      }
    }

    ledger.sale = { ...sale, undo };
    await ledger.save();

    // 검사·정비 일정은 운행 중인 차만 남긴다. 기다리지 않는다(실패해도 새벽 작업이 다시 맞춘다).
    syncVehicleServiceSchedules().catch((err) => console.error('[차량 판매] 정비·검사 일정 정리 실패:', err.message));

    logActivity({
      req, dept: '재무부', action: ACTIONS.VEHICLE_SALE,
      target: { model: 'VehicleLedger', id: ledger._id },
      summary: `${ledger.ledgerNo} ${ledger.header?.plateNo || ''} ${kind}${buyer ? `(${buyer})` : ''} ${amount.toLocaleString()}원`,
      meta: { kind, amount, date, buyer }
    });

    res.json({
      success: true,
      message: [`${ledger.ledgerNo} ${kind} 처리했습니다. 판매 대금 ${amount.toLocaleString()}원, 거래완료.`, ...notes].join(' ')
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    판매 취소 (잘못 넣었을 때 판매 전으로 되돌린다)
// @route   DELETE /api/ledgers/:id/sale
export const cancelSale = async (req, res) => {
  try {
    const ledger = await VehicleLedger.findById(req.params.id);
    if (!ledger?.sale?.at) return res.status(400).json({ success: false, message: '판매 처리한 갑지가 아닙니다.' });
    const { kind, amount } = ledger.sale;
    const undo = ledger.sale.undo || {};

    if (undo.entryAdded) {
      ledger.entries = ledger.entries.filter((e) => !(e.memo === SALE_ENTRY_MEMO && e.category === '인수가' && Number(e.amount) === Number(amount)));
      (undo.removedEntries || []).forEach((e) => ledger.entries.push(e));
    }
    ledger.status = undo.ledgerStatus || '운용중';

    if (ledger.vehicle && undo.vehicleStatus) {
      await Vehicle.updateOne({ _id: ledger.vehicle }, { $set: { status: undo.vehicleStatus } });
    }

    if (undo.contract?.id) {
      await Contract.updateOne({ _id: undo.contract.id }, {
        $set: { status: undo.contract.status, endReason: undo.contract.endReason, actualEndDate: undo.contract.actualEndDate }
      });
      if (undo.contract.rounds) {
        await BillingSchedule.updateOne({ contract: undo.contract.id }, { $set: { rounds: undo.contract.rounds, totalRounds: undo.contract.totalRounds } });
      }
    }

    ledger.sale = undefined;
    await ledger.save();
    syncVehicleServiceSchedules().catch((err) => console.error('[판매 취소] 정비·검사 일정 정리 실패:', err.message));

    logActivity({
      req, dept: '재무부', action: ACTIONS.VEHICLE_SALE,
      target: { model: 'VehicleLedger', id: ledger._id },
      summary: `${ledger.ledgerNo} ${ledger.header?.plateNo || ''} ${kind} 취소 (${Number(amount).toLocaleString()}원)`
    });

    res.json({ success: true, message: `${ledger.ledgerNo} 판매를 취소했습니다. 차·계약·갑지를 판매 전으로 되돌렸습니다.` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
