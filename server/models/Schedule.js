import mongoose from 'mongoose';
const { Schema } = mongoose;

const ScheduleSchema = new Schema({
  type: {
    type: String,
    enum: ['정기점검', '차량검사', '렌트만료', '청구서발송', '고지서납부'],
    required: true,
  },
  targetVehicle: { type: Schema.Types.ObjectId, ref: 'Vehicle' },
  targetContract: { type: Schema.Types.ObjectId, ref: 'Contract' },
  dueDate: { type: Date, required: true, index: true },
  status: { type: String, enum: ['예정', '완료', '알림발송됨'], default: '예정' },
  assignee: String,

  // 캘린더 칸에 그대로 찍히는 이름. 고지서 납부기한은 '계약사_차량번호_납부기한' 형태다.
  // 다른 일정은 차량·계약을 populate해서 이름을 만들지만, 고지서는 차량이 여러 대인 계약에서
  // 어느 차 건인지가 먼저 보여야 해서 만들어 둔 이름을 그대로 쓴다.
  title: String,
  amount: Number, // 고지서 금액. 칸을 눌렀을 때 얼마짜리인지 바로 보이게 한다.

  /**
   * 어느 고지서에서 만들어진 일정인지.
   *
   * 같은 고지서로 일정이 두 번 생기면 캘린더가 못 쓰게 된다. 매일 도는 작업이 이 값으로
   * 이미 만든 일정을 찾아 날짜·이름만 고친다. noticeNo가 없는 서식이 있어 key를 따로 둔다.
   */
  source: {
    billingSchedule: { type: Schema.Types.ObjectId, ref: 'BillingSchedule' },
    roundNo: Number,
    noticeNo: String,
    key: String // 고지서 한 건을 가리키는 값. noticeNo 또는 '차량번호|위반일|금액'
  },

  /**
   * 청구서 발송 일정에만 담는 값.
   *
   * 발송일이 주말·공휴일이면 앞의 영업일로 당겨 저장하는데, 당겨진 날짜만 남기면
   * "이게 원래 며칠 건이지"를 알 수 없다. 그래서 원래 날짜와 출금일을 함께 남긴다.
   */
  invoice: {
    roundNo: Number,
    billingDueDate: Date, // 출금일
    originalSendDate: Date, // 휴일이라 당기기 전의 발송 예정일
    movedForHoliday: Boolean
  }
}, { timestamps: true });

// Dashboard notifications query by `status` + `dueDate` range together;
// deletes/joins query by `targetContract`/`targetVehicle`
ScheduleSchema.index({ status: 1, dueDate: 1 });
ScheduleSchema.index({ targetContract: 1 });
ScheduleSchema.index({ targetVehicle: 1 });
// 고지서 일정은 이 값으로 찾아 고친다. 같은 고지서로 일정이 두 번 생기지 않게 유일하게 둔다.
// sparse: 고지서 일정이 아닌 건 이 값이 없다.
ScheduleSchema.index({ 'source.key': 1 }, { unique: true, sparse: true });

const Schedule = mongoose.model('Schedule', ScheduleSchema);
export default Schedule;
