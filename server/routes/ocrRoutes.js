import express from 'express';
import multer from 'multer';
import { readFineNotice } from '../utils/fineNoticeOcr.js';
import { findContractAtDate, findRentalAtDate } from '../utils/rentPeriod.js';
import BillingSchedule from '../models/BillingSchedule.js';
import RentalNotice from '../models/RentalNotice.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const router = express.Router();

/**
 * 이미 올린 고지서인지 본다.
 *
 * 고지서에 적힌 번호로 본다. 파일 지문(sha256)은 같은 고지서를 다시 스캔하면 달라져서
 * 이중 청구를 막지 못한다. 번호가 없는 서식이면 차량번호 + 위반일 + 금액으로 대신 본다.
 *
 * @returns {Promise<{contractNo: string, roundNo: number, fileName: string}|null>}
 */
const findAlreadyRegistered = async ({ noticeNo, plateNo, violationDate, amount }) => {
  const or = [];
  if (noticeNo) or.push({ 'rounds.attachments.noticeNo': noticeNo });
  if (plateNo && violationDate && amount) {
    or.push({
      rounds: {
        $elemMatch: {
          attachments: {
            $elemMatch: { plateNo, amount, occurredAt: new Date(violationDate) }
          }
        }
      }
    });
  }
  if (!or.length) return null;

  const schedule = await BillingSchedule.findOne({ $or: or })
    .populate('contract', 'contractNo leaseCompany')
    .lean();
  if (!schedule) return null;

  const isSame = (a) => (noticeNo && a.noticeNo === noticeNo)
    || (plateNo && a.plateNo === plateNo && Number(a.amount) === Number(amount)
        && a.occurredAt && String(a.occurredAt).slice(0, 10) === violationDate);

  for (const round of schedule.rounds || []) {
    const hit = (round.attachments || []).find(isSame);
    if (hit) {
      return {
        contractNo: schedule.contract?.contractNo || '',
        partyName: schedule.contract?.leaseCompany || '',
        roundNo: round.no,
        fileName: hit.fileName || ''
      };
    }
  }
  return null;
};

/**
 * 대차 고지서로 이미 올린 건인지 본다. 장기렌트 쪽과 같은 기준(고지번호, 없으면 차량+위반일+금액)이다.
 * @returns {Promise<{rentalNoticeId: any, plateNo: string, fileName: string}|null>}
 */
const findAlreadyRegisteredRental = async ({ noticeNo, plateNo, violationDate, amount }) => {
  const or = [];
  if (noticeNo) or.push({ noticeNo });
  if (plateNo && violationDate && amount) or.push({ plateNo, amount, occurredAt: new Date(violationDate) });
  if (!or.length) return null;
  const hit = await RentalNotice.findOne({ $or: or }).select('plateNo fileName').lean();
  return hit ? { rentalNoticeId: hit._id, plateNo: hit.plateNo, fileName: hit.fileName || '' } : null;
};

/**
 * 고지서 한 장이 어디로 가야 하는지 가른다.
 *
 *  longterm  장기렌트 계약 기간 안. 그 계약의 다음 청구서에 붙는다
 *  rental    대차 차량(단기렌트·사고대차) 운행 중. 대차 고지서로 모은다
 *  review    우리 차인데 어느 쪽인지 정하지 못했다(기간 밖, 계약 겹침, 위반일 못 읽음)
 *  notOurs   우리 차가 아니다
 *  unread    차량번호를 못 읽었다
 *
 * 여러 장을 한꺼번에 올리는 화면이 이 값으로 줄마다 색을 나누고, 확정된 건만 한 번에 등록한다.
 */
const routeOf = ({ plateNos, decided, rental, violationDate }) => {
  if (decided?.matched) return 'longterm';
  if (rental?.fleet && violationDate) {
    // 그날의 대여 기록이 있으면 대차가 확실하다.
    if (rental.candidates.length) return 'rental';
    // 대여 기록이 없어도 장기렌트로 나간 적이 없는 대차 차량이면 대차로 본다.
    // 장기렌트 이력이 있는 차는 지금 상태만 보고 가르지 않는다(그때는 장기렌트였을 수 있다).
    if (!decided) return 'rental';
  }
  if (decided || rental?.fleet) return 'review';
  return plateNos.length ? 'notOurs' : 'unread';
};

/**
 * 범칙금·과태료·미납통행료 고지서에서 값을 읽고, 위반일 기준으로 어느 계약 건인지 가른다.
 *
 * 읽은 값을 저장하지 않는다. 화면의 입력칸을 미리 채워 주고, 확인은 사람이 한다.
 * 계약을 하나로 좁히지 못하면(기간 밖·겹침) 고르지 않고 후보와 이유만 돌려준다.
 * 잘못 나간 청구서는 되돌리기 어렵다.
 *
 * @route POST /api/ocr/fine-notice
 */
router.post('/fine-notice', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: '읽을 파일이 없습니다.' });

    const result = await readFineNotice(req.file.buffer, req.file.mimetype, req.file.originalname);

    // 읽은 번호마다 그 시점의 계약을 찾는다. 고지서에는 우리 차가 아닌 번호도 섞여 읽힌다.
    const lookups = await Promise.all(
      result.plateNos.map((plateNo) => findContractAtDate(plateNo, result.violationDate || null))
    );

    // 우리 차량으로 확인된 번호만 남긴다
    const ours = result.plateNos
      .map((plateNo, i) => ({ plateNo, ...lookups[i] }))
      .filter((x) => x.candidates.length);

    // 계약이 하나로 좁혀진 건을 먼저 쓴다
    const decided = ours.find((x) => x.matched) || ours[0] || null;

    // 장기렌트 계약으로 정해지지 않았으면 대차 운행 중이었는지 본다. 읽힌 번호 중 대차 차량인 것을 쓴다.
    let rental = null;
    let rentalPlate = '';
    if (!decided?.matched) {
      for (const plateNo of result.plateNos) {
        const r = await findRentalAtDate(plateNo, result.violationDate || null);
        if (r.fleet) { rental = r; rentalPlate = plateNo; break; }
      }
    }
    const route = routeOf({ plateNos: result.plateNos, decided, rental, violationDate: result.violationDate });
    const plateNo = (route === 'rental' || (!decided && rentalPlate)) ? rentalPlate : (decided?.plateNo || result.plateNos[0] || '');

    const dupKey = { noticeNo: result.noticeNo, plateNo, violationDate: result.violationDate, amount: result.amount };
    const duplicate = (await findAlreadyRegistered(dupKey)) || (await findAlreadyRegisteredRental(dupKey));

    res.json({
      success: true,
      route,
      plateNo,
      kind: result.kind,
      amount: result.amount,
      candidates: result.candidates,
      surcharge: result.surcharge || 0,
      plateNos: result.plateNos,
      violationDate: result.violationDate,
      violationTime: result.violationTime,
      noticeDueDate: result.dueDate,
      noticeNo: result.noticeNo,
      // 위반일 기준으로 정해진 계약. 못 정하면 null이고 reason에 이유가 담긴다.
      matched: decided?.matched || null,
      contractCandidates: decided?.candidates || [],
      // 대차 운행 중이던 대여 건. matched가 비어 있으면 candidates에서 고르거나 고객을 직접 적는다.
      rental: rental ? {
        vehicleId: rental.vehicleId,
        matched: rental.matched,
        candidates: rental.candidates,
        reason: rental.reason
      } : null,
      reason: route === 'rental'
        ? (rental.reason || '')
        : (decided ? decided.reason : (result.plateNos.length ? '우리 차량이 아닙니다.' : '차량번호를 읽지 못했습니다.')),
      duplicate,
      textLength: result.text.length
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
