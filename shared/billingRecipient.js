// 청구서를 받는 메일 주소를 정하는 규칙. 화면마다 따로 찾으면 어떤 화면에서는 주소가 비어 보인다(대표님 2026-11-04).

// 고객 등록 때 메일이 없어 넣어 둔 자리표시 주소로는 보내지 않는다
const usable = (mail) => {
  const value = String(mail || '').trim();
  return value && !/^no-email@/i.test(value) ? value : '';
};

/** 가장 최근 회차에 보낸(또는 보내려고 승인한) 주소 */
export const lastSentTo = (rounds) => {
  const sent = [...(rounds || [])]
    .filter((r) => usable(r.sentTo || r.autoSend?.to))
    .sort((a, b) => b.no - a.no)[0];
  return sent ? usable(sent.sentTo || sent.autoSend?.to) : '';
};

/**
 * 계약별 주소 → 법인 청구 메일 → 고객 메일 → 지난 회차에 보낸 주소 순으로 찾는다.
 *
 * @param {object} schedule 회차표 (billingEmail, rounds)
 * @param {object} [company] 법인. 주지 않으면 schedule.company
 * @param {object} [customer] 고객. 주지 않으면 schedule.customer
 * @returns {string} 받는 주소. 어디에도 없으면 ''
 */
export const recipientOf = (schedule, company = schedule?.company, customer = schedule?.customer) => usable(schedule?.billingEmail)
  || usable(company?.billingEmail)
  || usable(customer?.email)
  || lastSentTo(schedule?.rounds);
