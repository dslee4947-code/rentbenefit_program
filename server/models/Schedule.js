import mongoose from 'mongoose';
const { Schema } = mongoose;

const ScheduleSchema = new Schema({
  type: {
    type: String,
    enum: ['정기점검', '차량검사', '렌트만료', '청구서발송'],
    required: true,
  },
  targetVehicle: { type: Schema.Types.ObjectId, ref: 'Vehicle' },
  targetContract: { type: Schema.Types.ObjectId, ref: 'Contract' },
  dueDate: { type: Date, required: true, index: true },
  status: { type: String, enum: ['예정', '완료', '알림발송됨'], default: '예정' },
  assignee: String,
}, { timestamps: true });

// Dashboard notifications query by `status` + `dueDate` range together;
// deletes/joins query by `targetContract`/`targetVehicle`
ScheduleSchema.index({ status: 1, dueDate: 1 });
ScheduleSchema.index({ targetContract: 1 });
ScheduleSchema.index({ targetVehicle: 1 });

const Schedule = mongoose.model('Schedule', ScheduleSchema);
export default Schedule;
