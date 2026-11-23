// 이미 발행한 청구서를 고칠 때의 규칙.
//
// 예전에는 발행한 회차를 막았다(고객이 받은 금액과 장부가 어긋난다). 그런데 청구한 뒤에
// 고객이 금액을 고쳐 달라고 하거나, 고지서를 직접 내겠다고 하는 일이 잦아 고칠 수 있게 열었다(대표님 2026-11-23).
// 대신 무엇을 언제 얼마에서 얼마로 고쳤는지 회차에 남기고, 고객에게 정정 청구서를 다시 보내야 한다고 알린다.
// 정정 청구서를 다시 발행하면 issuedAt이 고친 시각보다 뒤가 되어 '다시 보내야 함' 표시가 풀린다.

const won = (n) => `${Number(n || 0).toLocaleString()}원`;

/**
 * 발행한 회차를 고친 뒤 기록을 남기고 입금 상태를 새 청구액에 맞춘다. 발행 전 회차면 아무것도 하지 않는다.
 *
 * @param {object} round 회차 (recalcRound로 새 total을 계산한 뒤에 부른다)
 * @param {{totalBefore: number, summary: string, by?: string, now?: Date}} info
 * @returns {{totalBefore: number, totalAfter: number, overpaid: number, unpaid: number, message: string}|null}
 */
export const noteIssuedRevision = (round, { totalBefore, summary, by = '', now = new Date() }) => {
  if (!round?.issuedAt) return null;
  const totalAfter = Number(round.total) || 0;
  if (!Array.isArray(round.revisions)) round.revisions = [];
  round.revisions.push({ at: now, by, summary, totalBefore: Number(totalBefore) || 0, totalAfter });
  round.revisedAt = now;

  // 이미 입금 결과를 적은 회차는 새 청구액으로 다시 맞춘다.
  let overpaid = 0;
  let unpaid = 0;
  const paid = Number(round.paidAmount) || 0;
  if (['입금완료', '미납'].includes(round.status) && paid > 0) {
    if (paid >= totalAfter) {
      round.status = '입금완료';
      overpaid = paid - totalAfter;
    } else {
      round.status = '미납';
      unpaid = totalAfter - paid;
    }
  }

  let message = `발행한 ${round.no}회차 청구서를 고쳤습니다`;
  message += totalAfter !== Number(totalBefore) ? ` (청구액 ${won(totalBefore)} → ${won(totalAfter)}).` : '.';
  message += ' 청구서 화면에서 [정정본 PDF 저장] 또는 [정정본 발행 + 메일]로 정정 청구서를 다시 만들어 주세요.';
  if (overpaid > 0) message += ` 이미 받은 돈이 ${won(overpaid)} 더 많습니다. 다음 회차 '전월 초과입금'에 넣어 주세요.`;
  if (unpaid > 0) message += ` 받은 돈보다 청구액이 커져 ${won(unpaid)}이 미납으로 다음 회차에 넘어갑니다.`;

  return { totalBefore: Number(totalBefore) || 0, totalAfter, overpaid, unpaid, message };
};

/** 고친 뒤 아직 정정 청구서를 다시 발행하지 않았는지. */
export const needsReissue = (round) => Boolean(round?.issuedAt && round?.revisedAt
  && new Date(round.revisedAt) > new Date(round.issuedAt));
