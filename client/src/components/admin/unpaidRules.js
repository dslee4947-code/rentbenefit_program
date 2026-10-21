// 미납 처리 기준(서버 billingScheduleController의 LATE_GRACE_DAYS와 같다). 출금일 뒤 15일 안은 아직 연체가 아니다.
export const LATE_GRACE_DAYS = 15;

/** 출금일이 지난 날수(오늘이 출금일이면 0, 아직 안 왔으면 음수) */
export const daysSinceDue = (r) => Math.floor((Date.now() - new Date(r.dueDate).getTime()) / 864e5);
