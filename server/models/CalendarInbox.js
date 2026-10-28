import mongoose from 'mongoose';
const { Schema } = mongoose;

/**
 * 구글 업무캘린더에서 읽어 온 정비 일정 중 아직 정비 기록으로 옮기지 않은 것('확인 대기').
 *
 * 업무캘린더에는 우리 차 정비뿐 아니라 고객 차 점검·대차·센터 정보까지 섞여 있다.
 * 그래서 자동으로 기록을 만들지 않고, 우리 차량번호를 찾은 일정만 여기 모아 직원이 확인하고 옮긴다.
 * 일정 하나에 한 줄이다(eventId). 일정을 고치면 같은 줄을 고친다.
 */
const CalendarInboxSchema = new Schema({
  eventId: { type: String, required: true, unique: true },
  eventUpdated: Date, // 캘린더에서 마지막으로 고친 때
  htmlLink: String,
  start: Date,
  title: { type: String, default: '' },
  description: { type: String, default: '' }, // HTML을 걷어 낸 본문
  colorId: String,

  // 본문 'AS일정 기재 양식'에서 읽은 값 (utils/calendarInboxSync.js parseServiceEvent)
  parsed: {
    carModel: String,
    plateNo: String,
    staff: String,
    shop: String,
    request: String,
    done: String,
    costText: String,
    amount: Number,
    mileageIn: Number,
    mileageOut: Number,
    fuelIn: String,
    fuelOut: String,
    kinds: [String] // 짐작한 종류. 첫째가 주 종류, 뒤는 함께 한 정기점검·자동차검사
  },

  vehicle: { type: Schema.Types.ObjectId, ref: 'Vehicle' },

  // 대기: 우리 차를 찾음 / 번호없음: 양식 줄이 없어 차를 못 찾음(제목에 '렌트'가 있는 정비 일정)
  // 옮김: 정비 기록으로 옮김 / 제외: 정비 기록이 아니라고 직원이 뺌
  status: { type: String, enum: ['대기', '번호없음', '옮김', '제외'], default: '대기', index: true },
  // 옮긴 뒤에 캘린더에서 일정을 고치거나 지웠으면 표시해 다시 보게 한다
  changedAfterImport: { type: Boolean, default: false },
  eventDeleted: { type: Boolean, default: false },
  serviceIds: [{ type: Schema.Types.ObjectId, ref: 'VehicleService' }],
  handledBy: String,
  handledAt: Date
}, { timestamps: true });

const CalendarInbox = mongoose.model('CalendarInbox', CalendarInboxSchema);

export default CalendarInbox;
