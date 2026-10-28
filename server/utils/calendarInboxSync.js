import Setting from '../models/Setting.js';
import Vehicle from '../models/Vehicle.js';
import VehicleService from '../models/VehicleService.js';
import CalendarInbox from '../models/CalendarInbox.js';
import { isGoogleCalendarConfigured, listChangedEvents } from './googleCalendar.js';

/**
 * 구글 업무캘린더 → 정비 기록 '확인 대기'.
 *
 * 몇 분마다 그사이 바뀐 일정만 읽는다. 일정 본문의 'AS일정 기재 양식'
 * ("261001 / 영범 - < CLS350 / 15저1692 > AS (입고지 / 담당자) …")에서 차량번호를 찾아
 * 우리 차면 '대기'로 올린다. 고객 차·대차·센터 정보 일정이 같은 캘린더에 섞여 있어 기록을 바로 만들지 않는다.
 *
 * 2026-10-19 이전 일정은 이미 한 번에 옮겼다(migrations/2026-10-19_import_calendar_services.js).
 * 그때 옮긴 일정은 VehicleService.calendarEventId로 알아보고 건너뛴다.
 */

const SYNC_KEY = 'googleCalendarSync';
// 처음 돌 때 이때 이후 바뀐 일정부터 본다(일괄 이관 다음 날)
const FIRST_SINCE = new Date('2026-10-19T00:00:00+09:00');
// 읽는 사이 바뀐 일정을 놓치지 않게 지난번 시각보다 조금 앞에서 다시 읽는다
const OVERLAP_MS = 5 * 60 * 1000;

const PLATE = /(\d{2,3})\s*([가-힣])\s*(\d{4})/;
const PLATE_ALL = /(\d{2,3})\s*([가-힣])\s*(\d{4})/g;
const HEADER = /<\s*([^/<>\n]+?)\s*\/\s*(\d{2,3}\s*[가-힣]\s*\d{4})\s*>/;
export const plateKey = (p) => String(p || '').replace(/\s+/g, '');

// 정기점검·검사 단어는 일괄 이관(2026-10-19)과 같은 기준을 쓴다
const CHECK_WORD = /정기\s*점검|엔진\s*오일/;
const INSPECT_WORD = /자동차\s*(정기|종합)?\s*검사|종합\s*검사|정기\s*검사/;
const RE_INSPECT = /재검사|검사\s*부적합|검사\s*대행/;
const REPAIR_WORD = /수리|고장|경고등|점등|교환|누유|누수|소음|떨림|방전/;
const SERVICE_WORD = /점검|수리|검사|정비|\bAS\b|교환|오일/;
// 일정 색 '귤'(6)은 사고수리 (AS일정 기재 양식의 색상 분류)
const ACCIDENT_COLOR = '6';

// 양식의 다음 칸 이름이 빈 칸에 딸려 들어온 경우는 빈 글로 본다
const FORM_LABEL = /^(\d+\.\s*)?(점검 안내 전화|픽업후 확인전화|입고후 확인전화|점검 비용|인도 확인 전화)\s*:?\s*$/;
const oneLine = (s) => {
  const t = String(s || '').replace(/고객님성향및기분[\s\S]*$/, '').replace(/\s+/g, ' ').trim();
  return FORM_LABEL.test(t) ? '' : t;
};

/** 캘린더 본문은 HTML(<br>, <span>)일 때가 있다. 양식의 '< 차종 / 번호 >'는 지우지 않게 아는 태그만 걷는다. */
export const plainText = (html) => String(html || '')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/?(span|b|i|u|div|p|a|font|strong|em)(\s[^>]*)?>/gi, '')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .trim();

const lineValue = (text, label) => {
  const m = text.match(new RegExp(`^\\s*${label}\\s*:(.*)$`, 'm'));
  return m ? oneLine(m[1]) : '';
};

const kmOf = (line) => {
  const m = String(line || '').match(/([\d,]{3,})\s*km/i);
  const n = m ? Number(m[1].replace(/,/g, '')) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
const fuelOf = (line) => {
  const m = String(line || '').match(/주유\s*([^/]+)/) || String(line || '').match(/\/\s*(\d{1,3}\s*%)\s*\//);
  const v = m ? m[1].trim() : '';
  return v === '상태' || v === '' ? '' : v;
};

/** "1+3.부가세포함 1,359,710원", "55만원", "무상" → 금액. 못 읽으면 undefined (직원이 적는다) */
export const amountOf = (text) => {
  const t = String(text || '');
  if (!t) return undefined;
  const won = t.match(/(\d{1,3}(?:,\d{3})+|\d{4,})\s*원/);
  if (won) return Number(won[1].replace(/,/g, ''));
  const man = t.match(/(\d+(?:\.\d+)?)\s*만\s*(?:\d+\s*천\s*)?원/);
  if (man) return Math.round(Number(man[1]) * 10000);
  if (/무상|무료/.test(t)) return 0;
  return undefined;
};

/**
 * 종류 짐작. 첫째가 주 종류, 뒤는 같은 방문에 함께 한 정기점검·자동차검사(일괄 이관과 같은 규칙).
 * 직원이 옮길 때 고칠 수 있다.
 */
export const guessKinds = ({ title, request, done, colorId }) => {
  const text = `${title} ${request} ${done}`;
  let main;
  if (/사고/.test(`${title} ${request}`) || colorId === ACCIDENT_COLOR) main = '사고수리';
  else if (INSPECT_WORD.test(title) && !CHECK_WORD.test(text)) main = '자동차검사';
  else if (CHECK_WORD.test(text)) main = '정기점검';
  else if (REPAIR_WORD.test(text)) main = '고장수리';
  else main = '기타';
  const kinds = [main];
  if (main !== '정기점검' && CHECK_WORD.test(text)) kinds.push('정기점검');
  const inspected = INSPECT_WORD.test(request) || (INSPECT_WORD.test(done) && /완료|합격|통과|적합/.test(done)) || RE_INSPECT.test(text);
  if (main !== '자동차검사' && inspected) kinds.push('자동차검사');
  return kinds;
};

/**
 * 일정 하나를 읽는다.
 * @returns {{header: boolean, carModel?: string, plateNo?: string, ...}}
 */
export const parseServiceEvent = (event) => {
  const title = String(event.summary || '');
  const text = plainText(event.description);
  const header = text.match(HEADER);
  const headerLine = header ? text.split('\n').find((l) => l.includes(header[0])) || '' : '';
  const staff = headerLine ? oneLine((headerLine.split('<')[0].split('/').pop() || '').replace(/-\s*$/, '')) : '';
  // 양식 그대로 둔 빈칸("입고지 / 담당자")은 비운다
  const shopRaw = (headerLine.match(/AS\s*\(([^)]*)\)/) || [])[1] || '';
  const shop = /^\s*입고지\s*\/\s*담당자\s*$/.test(shopRaw) ? '' : shopRaw.replace(/\/\s*$/, '');
  const pickup = lineValue(text, '픽업');
  const deliver = lineValue(text, '인도');
  const request = lineValue(text, '점검 의뢰');
  const done = lineValue(text, '점검 내용');
  const costText = lineValue(text, '점검 비용');
  return {
    header: Boolean(header),
    carModel: header ? header[1].trim() : '',
    plateNo: header ? plateKey(header[2]) : '',
    staff,
    shop: oneLine(shop),
    request,
    done,
    costText,
    amount: amountOf(costText),
    mileageIn: kmOf(pickup),
    mileageOut: kmOf(deliver),
    fuelIn: fuelOf(pickup),
    fuelOut: fuelOf(deliver),
    kinds: guessKinds({ title, request, done, colorId: event.colorId }),
    text
  };
};

const startOf = (event) => {
  const s = event.start?.dateTime || (event.start?.date ? `${event.start.date}T00:00:00+09:00` : null);
  return s ? new Date(s) : null;
};

/**
 * 바뀐 일정을 읽어 '확인 대기'를 맞춘다.
 * @param {object} [options]
 * @param {Date} [options.since] 지정하면 이때부터 다시 읽는다(시험·복구용)
 * @param {boolean} [options.dryRun] true면 세기만 하고 쓰지 않는다
 */
export const syncCalendarInbox = async ({ since, dryRun = false } = {}) => {
  if (!isGoogleCalendarConfigured()) return { skipped: true, reason: '구글 캘린더 열쇠가 설정되지 않았습니다.' };
  const state = await Setting.findOne({ key: SYNC_KEY }).lean();
  const from = since || (state?.value?.lastSyncAt ? new Date(new Date(state.value.lastSyncAt).getTime() - OVERLAP_MS) : FIRST_SINCE);
  const startedAt = new Date();
  const events = await listChangedEvents(from);

  const vehicles = await Vehicle.find({ plateNo: { $nin: [null, ''] } }).select('plateNo status').lean();
  // 같은 번호판으로 차량 문서가 둘이면(재계약) 운행 중인 쪽을 고른다
  const byPlate = new Map();
  for (const v of vehicles) {
    const k = plateKey(v.plateNo);
    const cur = byPlate.get(k);
    if (!cur || (cur.status === '거래완료' && v.status !== '거래완료')) byPlate.set(k, v);
  }
  const ids = events.map((e) => e.id);
  const imported = new Set((await VehicleService.find({ calendarEventId: { $in: ids.flatMap((id) => [id, `${id}#정기점검`, `${id}#자동차검사`]) } })
    .select('calendarEventId').lean()).map((r) => r.calendarEventId.split('#')[0]));
  const existing = new Map((await CalendarInbox.find({ eventId: { $in: ids } }).lean()).map((x) => [x.eventId, x]));

  const counts = { read: events.length, waiting: 0, noPlate: 0, updated: 0, removed: 0, flagged: 0 };
  for (const e of events) {
    const old = existing.get(e.id);
    // 프로그램이 올린 일정은 프로그램 기록이 원본이라 여기서 다시 올리지 않는다
    if (e.extendedProperties?.private?.rbSource === 'program') continue;

    if (e.status === 'cancelled') {
      if (!old) continue;
      if (old.status === '옮김') {
        counts.flagged += 1;
        if (!dryRun) await CalendarInbox.updateOne({ _id: old._id }, { $set: { eventDeleted: true } });
      } else {
        counts.removed += 1;
        if (!dryRun) await CalendarInbox.deleteOne({ _id: old._id });
      }
      continue;
    }
    // 반복 일정은 'AS일정 기재 양식'·센터 정보 같은 안내라 정비 기록이 아니다
    if (e.recurringEventId) continue;
    if (!old && imported.has(e.id)) continue;

    const title = String(e.summary || '');
    const p = parseServiceEvent(e);
    let vehicle = null;
    let status = null;
    if (p.header) {
      vehicle = byPlate.get(p.plateNo) || null; // 양식 줄의 차가 고객 차면 건너뛴다
      if (vehicle) status = '대기';
    } else {
      // 양식 줄이 없으면 제목에 적힌 번호로 찾는다
      const plates = (title.match(PLATE_ALL) || []).map(plateKey);
      vehicle = plates.map((k) => byPlate.get(k)).find(Boolean) || null;
      if (vehicle && SERVICE_WORD.test(title)) status = '대기';
      else if (!vehicle && /렌트/.test(title) && SERVICE_WORD.test(title) && !/대차/.test(title)) status = '번호없음';
    }
    if (!status) {
      // 전에 올렸는데 고쳐서 우리 차가 아니게 됐으면 내린다
      if (old && old.status !== '옮김' && old.status !== '제외') {
        counts.removed += 1;
        if (!dryRun) await CalendarInbox.deleteOne({ _id: old._id });
      }
      continue;
    }

    const doc = {
      eventUpdated: e.updated ? new Date(e.updated) : undefined,
      htmlLink: e.htmlLink,
      start: startOf(e),
      title,
      description: p.text.slice(0, 4000),
      colorId: e.colorId,
      parsed: {
        carModel: p.carModel, plateNo: vehicle?.plateNo || p.plateNo, staff: p.staff, shop: p.shop,
        request: p.request, done: p.done, costText: p.costText, amount: p.amount,
        mileageIn: p.mileageIn, mileageOut: p.mileageOut, fuelIn: p.fuelIn, fuelOut: p.fuelOut, kinds: p.kinds
      },
      vehicle: vehicle?._id
    };
    if (!old) {
      counts[status === '대기' ? 'waiting' : 'noPlate'] += 1;
      if (!dryRun) await CalendarInbox.create({ eventId: e.id, status, ...doc });
    } else if (String(old.eventUpdated?.toISOString?.() || '') !== String(doc.eventUpdated?.toISOString?.() || '')) {
      counts.updated += 1;
      if (old.status === '옮김') counts.flagged += 1;
      // 옮긴 뒤에 고친 일정은 기록을 다시 보게 표시만 한다. 제외한 일정은 그대로 둔다
      const set = old.status === '옮김' ? { ...doc, changedAfterImport: true }
        : old.status === '제외' ? doc
          : { ...doc, status };
      if (!dryRun) await CalendarInbox.updateOne({ _id: old._id }, { $set: set });
    }
  }

  if (!dryRun) {
    await Setting.updateOne({ key: SYNC_KEY }, { $set: { value: { lastSyncAt: startedAt, lastCounts: counts }, updatedBy: '구글 캘린더 읽기' } }, { upsert: true });
  }
  return { from, ...counts };
};
