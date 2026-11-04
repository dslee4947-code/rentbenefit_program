import { mergeCarModel } from './carModel.js';

const sum = (list, get) => list.reduce((s, x) => s + (Number(get(x)) || 0), 0);

/**
 * 안내할 보증금·선수금. 차량 DB 값을 먼저 쓴다(정산서와 같은 값).
 * 엑셀에서 옮긴 계약은 계약 금액 칸이 0이고, 출고 전 계약은 차량 칸이 비어 있을 수 있어 차량 합계가 0이면 계약 금액을 쓴다.
 */
export const depositAmountsOf = (vehicles, pricing) => ({
  deposit: sum(vehicles, (v) => v.deposit) || Number(pricing?.deposit) || 0,
  advancePayment: sum(vehicles, (v) => v.advancePayment) || Number(pricing?.advancePayment) || 0
});

/** 메일 제목과 서류 제목에 쓰는 이름. 받을 돈만 적는다 */
export const noticeLabel = ({ deposit, advancePayment }) => [deposit > 0 && '보증금', advancePayment > 0 && '선수금'].filter(Boolean).join('·');

/** 원장에 들어온 보증금·선수금. 돌려준 줄(음수)은 빼지 않는다. 받은 적이 있는지만 본다 */
export const receivedOf = (ledgers) => {
  const entries = ledgers.flatMap((l) => l.entries || []).filter((e) => e.side === '입금' && Number(e.amount) > 0);
  const of = (category) => sum(entries.filter((e) => e.category === category), (e) => e.amount);
  return { depositIn: of('보증금'), advanceIn: of('선납금') };
};

/** 목록 한 줄. 받을 돈 전부가 원장에 들어와 있으면 paid다 */
export const noticeItemOf = ({ contract, vehicles, ledgers, partyName, to }) => {
  const amounts = depositAmountsOf(vehicles, contract.pricing);
  const received = receivedOf(ledgers);
  const history = [...(contract.depositNotices || [])].sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
  return {
    contractId: String(contract._id),
    contractNo: contract.contractNo,
    contractDate: contract.contractDate || null,
    partyName,
    vehicles: vehicles.map((v) => ({ plateNo: v.plateNo || '', carModel: mergeCarModel(v.carModel, v.carSpec) })),
    ...amounts,
    ...received,
    label: noticeLabel(amounts),
    paid: amounts.deposit <= received.depositIn && amounts.advancePayment <= received.advanceIn,
    to,
    lastSent: history[0] || null
  };
};
