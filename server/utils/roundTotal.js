import { isMaintenanceKind } from './maintenance.js';

/**
 * 회차 금액을 다시 계산한다.
 *
 * 서류(범칙금 고지서 등)에 금액을 적어 두면 그 합계가 청구 금액이 된다.
 * 한 달에 고지서가 서너 장 오면 사람이 더해 넣다가 틀리는 일이 가장 잦았다.
 * 금액을 적지 않고 서류만 올린 경우에는 손으로 넣은 값을 건드리지 않는다.
 *
 * 청구 화면(billingScheduleController)과 단기렌트 회차표(shortTermBilling)가 함께 쓴다.
 *
 * @param {object} round 회차 (mongoose 서브도큐먼트)
 */
export const recalcRound = (round) => {
  const atts = round.attachments || [];
  const sumOf = (pick) => atts.filter(pick).reduce((sum, a) => sum + (Number(a.amount) || 0), 0);
  const hasAmount = (pick) => atts.some((a) => pick(a) && Number(a.amount) > 0);

  const isMaint = (a) => isMaintenanceKind(a.kind);
  const isFine = (a) => !isMaintenanceKind(a.kind);
  // 우리가 청구하지 않는 고지서는 금액에서 뺀다. 첨부는 그대로 두어 기록은 남긴다.
  //  납부완료 - 고객이 직접 냈다
  //  변경완료 - 명의가 고객에게 넘어가 우리 손을 떠났다
  //  고객납부 - 예전 상태값. 쓰던 데이터를 살린다
  //  청구취소 - 고객이 직접 내겠다고 해 청구에서 뺐다(낸 것을 확인하면 납부완료)
  // '있는지'는 상태와 무관하게 보고 '얼마인지'만 걸러야, 모두 빠진 회차에서 예전 금액이 남지 않는다.
  const NOT_BILLED = ['납부완료', '변경완료', '고객납부', '청구취소'];
  const billable = (a) => !NOT_BILLED.includes(a.noticeStatus);

  if (hasAmount(isFine)) round.fine = sumOf((a) => isFine(a) && billable(a));
  if (hasAmount(isMaint)) round.maintenance = sumOf((a) => isMaint(a) && billable(a));

  // 기타 청구는 항목명을 적을 수 있게 배열로 두고, other는 그 합계로 유지한다(청구서 양식·합계식은 그대로).
  if ((round.extras || []).length) {
    round.other = round.extras.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  }

  round.total = (round.monthlyRent || 0) + (round.prevUnpaid || 0) + (round.interest || 0)
    + (round.fine || 0) + (round.maintenance || 0) + (round.other || 0) - (round.prevOverpaid || 0);
  return round;
};
