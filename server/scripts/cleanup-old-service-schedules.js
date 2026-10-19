import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Schedule from '../models/Schedule.js';
import { syncVehicleServiceSchedules } from '../utils/vehicleServiceScheduleJob.js';

dotenv.config();

/**
 * 계약 등록 때 한꺼번에 만들던 옛 정기점검·차량검사 일정을 치운다.
 *
 * 예전 계약 등록은 계약일부터 6개월마다 점검, 24개월에 검사를 캘린더에 넣었다.
 * 검사는 최초등록일 기준이고 점검은 정비 가입 차만 약정 주행거리대로 하므로 날짜가 틀렸다.
 * 이제 utils/vehicleServiceScheduleJob.js가 차마다 다음 한 건만 잡으니(열쇠 source.key가 'svc:'로 시작),
 * 열쇠 없는 옛 일정 중 아직 오지 않은 '예정' 건을 지운다. 지난 일정은 기록으로 남긴다.
 *
 * 기본은 보여 주기만 한다. 운영 DB에 쓰므로 결과를 보고 --apply를 붙여 다시 돌린다.
 *
 *   node scripts/cleanup-old-service-schedules.js            몇 건인지 보기만 (저장 안 함)
 *   node scripts/cleanup-old-service-schedules.js --apply    실제로 지운다
 */

const apply = process.argv.includes('--apply');

const main = async () => {
  // 시험 실행에서는 색인·컬렉션도 만들지 않는다
  mongoose.set('autoIndex', apply);
  mongoose.set('autoCreate', apply);
  await mongoose.connect(process.env.MONGODB_ATLAS_URL || process.env.MONGO_URI, { autoIndex: apply, autoCreate: apply });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const oldFilter = {
    type: { $in: ['정기점검', '차량검사'] },
    $or: [{ 'source.key': { $exists: false } }, { 'source.key': null }, { 'source.key': '' }]
  };

  const all = await Schedule.find(oldFilter).populate('targetVehicle', 'plateNo').lean();
  const targets = all.filter((s) => s.status === '예정' && new Date(s.dueDate) >= today);
  const byType = {};
  for (const s of targets) byType[s.type] = (byType[s.type] || 0) + 1;

  console.log(`\n=== 옛 정기점검·차량검사 일정 ${apply ? '(실제 삭제)' : '(시험 실행, 저장 안 함)'} ===`);
  console.log(`열쇠 없는 옛 일정 전체 ${all.length}건, 그중 지울 앞으로의 '예정' ${targets.length}건`, byType);
  targets.forEach((s) => console.log(`  ${s.type} ${s.targetVehicle?.plateNo || '(차량 없음)'} ${new Date(s.dueDate).toISOString().slice(0, 10)}`));

  if (apply && targets.length) {
    const res = await Schedule.deleteMany({ _id: { $in: targets.map((s) => s._id) } });
    console.log(`지웠습니다: ${res.deletedCount}건`);
  }

  // 새 작업이 캘린더에 무엇을 잡을지 세기만 한다. 실제로 잡는 건 서버가 켜질 때와 매일 03:30이다.
  console.log('\n새 정비·검사 일정 작업(세기만):');
  await syncVehicleServiceSchedules({ dryRun: true });

  if (!apply) console.log('\n저장하지 않았습니다. 실제로 지우려면 --apply를 붙여 다시 실행하세요.');
  await mongoose.disconnect();
};

main().catch(async (err) => {
  console.error('정리 실패:', err);
  await mongoose.disconnect();
  process.exit(1);
});
