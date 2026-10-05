import ActivityLog from '../models/ActivityLog.js';

/**
 * 활동 기록에 쓰는 일의 이름.
 *
 * 일일 보고가 이 값으로 건수를 센다("청구서 발행 6건"). 곳곳에서 문자열을 따로 적으면
 * '청구서발행'과 '청구서 발행'처럼 갈려 집계가 틀어지므로 여기서만 고른다.
 */
export const ACTIONS = Object.freeze({
  INQUIRY_CREATE: '문의 접수',
  QUOTE_CREATE: '견적 작성',
  CONTRACT_CREATE: '계약 등록',
  VEHICLE_CREATE: '차량 등록',
  VEHICLE_STATUS_CHANGE: '차량 상태 변경',
  INVOICE_ISSUE: '청구서 발행',
  INVOICE_SEND: '청구서 발송',
  PAYMENT_UPDATE: '입금 입력',
  ROUND_STATUS_CHANGE: '회차 상태 변경',
  NOTICE_REGISTER: '고지서 등록',
  LEDGER_EDIT: '원장 수정',
  COMPANY_BOOK_EDIT: '회사 장부 수정',
  SYNC: '동기화'
});

const SYSTEM_NAME = '시스템';

/**
 * 활동 기록을 한 줄 남긴다.
 *
 * 기록이 실패해도 본래 일(저장, 발행, 입금 처리)은 이미 끝났으므로 되돌리거나 오류로 돌려주지 않는다.
 * 그래서 이 함수는 절대 예외를 던지지 않고, 호출하는 쪽도 기다리지 않아도 된다.
 *
 * @param {object} params
 * @param {object} [params.req] Express 요청. 로그인한 사람(req.user)을 여기서 꺼낸다.
 * @param {object} [params.user] req가 없을 때 직접 넘기는 사용자
 * @param {string} params.dept 부서 (models/ActivityLog.js의 DEPARTMENTS)
 * @param {string} params.action 일의 이름 (ACTIONS)
 * @param {{model: string, id: any}} [params.target] 대상 문서
 * @param {string} [params.summary] 사람이 읽는 한 줄 요약
 * @param {object} [params.meta] 집계용 부가 정보
 * @returns {Promise<void>}
 */
export const logActivity = async ({ req, user, dept, action, target, summary = '', meta } = {}) => {
  try {
    const actor = user || req?.user || null;
    await ActivityLog.create({
      user: actor?._id,
      userName: actor?.name || SYSTEM_NAME,
      dept,
      action,
      target: target?.id ? { model: target.model, id: target.id } : undefined,
      summary,
      meta
    });
  } catch (err) {
    console.error(`[활동 기록] 남기지 못했습니다 (${dept} / ${action}):`, err.message);
  }
};
