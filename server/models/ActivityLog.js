import mongoose from 'mongoose';
const { Schema } = mongoose;

/**
 * 활동 기록. 누가, 언제, 어느 부서 일로, 무엇을 했는지 한 줄씩 남긴다.
 *
 * 두 가지에 쓴다.
 * 1) 일일 보고의 "오늘 한 일" 집계. 각 문서에는 updatedAt만 있어서 오늘 무엇이 바뀌었는지
 *    알 수 없다. 여기서 날짜와 부서로 세면 된다.
 * 2) 감사 기록. 청구서 발송이나 입금 처리처럼 돈이 걸린 일은 누가 했는지 되짚을 수 있어야 한다.
 *
 * 기록은 고치거나 지우지 않는다. 남기는 쪽 코드는 utils/activityLog.js 하나로 모은다.
 */

// 부서 이름. 일일 보고의 부서 구분과 같다.
export const DEPARTMENTS = [
  '영업부',
  '계약·출고부',
  '단기렌트부',
  '사고대차부',
  '청구부',
  '차량관리부',
  '재무부',
  '인수인계부', // 업무 매뉴얼·인수인계서 작성과 관리
  '디자인·마케팅부',
  '비서실',
  '시스템' // 사람이 아니라 정기 작업·동기화가 한 일
];

const ActivityLogSchema = new Schema({
  at: { type: Date, default: Date.now, required: true },

  // 사람이 한 일이면 user를 채운다. 정기 작업이 한 일이면 비워 두고 userName에 '시스템'을 적는다.
  // 이름을 따로 남기는 이유: 계정이 지워져도 기록에는 누가 했는지 남아야 한다.
  user: { type: Schema.Types.ObjectId, ref: 'User' },
  userName: { type: String, default: '' },

  dept: { type: String, enum: DEPARTMENTS, required: true },

  // 무슨 일인지. 보고에서 이 값으로 건수를 세므로 utils/activityLog.js의 ACTIONS에서 골라 쓴다.
  action: { type: String, required: true },

  // 대상 문서. 모델 이름과 _id를 함께 둬 어느 컬렉션이든 가리킬 수 있게 한다.
  target: {
    model: String,
    id: Schema.Types.ObjectId
  },

  // 사람이 읽는 한 줄 요약 (예: "㈜○○ 3회차 청구서 발행·메일 발송")
  summary: { type: String, default: '' },

  // 집계에 쓸 숫자나 부가 정보 (예: 금액, 건수). 모양을 고정하지 않는다.
  meta: { type: Schema.Types.Mixed }
}, { versionKey: false });

ActivityLogSchema.index({ at: -1 });
ActivityLogSchema.index({ dept: 1, at: -1 });
ActivityLogSchema.index({ 'target.model': 1, 'target.id': 1 });

const ActivityLog = mongoose.model('ActivityLog', ActivityLogSchema);

export default ActivityLog;
