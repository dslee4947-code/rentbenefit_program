import Vehicle from '../models/Vehicle.js';

/**
 * TS 사이버검사소(cyberts.kr) '검사유효기간조회'로 차마다 정기검사 유효기간을 받아 온다.
 *
 * 등록일로 계산한 검사일은 연기·늦은 검사·원장에 빠진 검사비를 모른다(2026-10-28 대표님 지적:
 * 검사를 마친 차가 '검사일 지남'으로 떴다). 사이트는 로그인 없이 차량번호 + 법인등록번호 앞 6자리로
 * 조회되므로, 그 만료일을 Vehicle.inspectionValidity에 적어 두고 다음 검사일로 쓴다.
 */

const BASE = 'https://www.cyberts.kr/is/pvi/pvi/';
const UA = 'Mozilla/5.0';
// 회사 법인등록번호 앞 6자리 (대표님 2026-10-28)
const REG_PREFIX = process.env.CYBERTS_REG_PREFIX || '110111';

const ymdOf = (s) => (/^\d{8}$/.test(s || '') ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : '');

/** 조회 화면을 한 번 열어 세션 쿠키와 CSRF 토큰을 받는다. */
const openSession = async () => {
  const res = await fetch(`${BASE}readIsPviPrsecValidityInqireView.do`, { headers: { 'User-Agent': UA } });
  const cookie = (res.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  const token = (await res.text()).match(/X-CSRF-TOKEN", "([^"]+)/)?.[1];
  if (!token) throw new Error('사이버검사소 조회 화면을 열지 못했습니다');
  return { cookie, token };
};

/**
 * 차 한 대의 유효기간.
 * @returns {Promise<{from: string, to: string}|null>} 우리 법인 차가 아니거나 없으면 null
 */
const lookup = async (session, plateNo) => {
  const body = new URLSearchParams({ searchType: 'car', searchCarNo: plateNo, searchRegiNum: REG_PREFIX, _csrf: session.token });
  const res = await fetch(`${BASE}readIsPviPrsecValidityInqireInfo.do`, {
    method: 'POST',
    body,
    headers: {
      'User-Agent': UA,
      Cookie: session.cookie,
      'X-CSRF-TOKEN': session.token,
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Referer: `${BASE}readIsPviPrsecValidityInqireView.do`
    }
  });
  const list = JSON.parse(await res.text()).isPviPrsecValidityInqireDomain || [];
  // 여러 줄이면 만료일이 가장 늦은 것이 지금 유효기간이다
  const row = [...list].sort((a, b) => (a.gsTymd < b.gsTymd ? 1 : -1))[0];
  return row ? { from: ymdOf(row.gsFymd), to: ymdOf(row.gsTymd) } : null;
};

/**
 * 차량 전체를 조회해 inspectionValidity를 맞춘다. 거래완료 차는 우리 차가 아니라 건너뛴다.
 * 사이트에 무리가 가지 않게 한 대씩 0.4초 간격으로 묻는다(160대 ≈ 1~2분).
 * @returns {Promise<{checked: number, found: number, changed: number, notFound: string[]}>}
 */
export const syncInspectionValidity = async () => {
  const vehicles = await Vehicle.find({ status: { $ne: '거래완료' }, plateNo: { $nin: [null, ''] } })
    .select('plateNo inspectionValidity').lean();
  const session = await openSession();
  const now = new Date();
  let found = 0;
  let changed = 0;
  const notFound = [];
  for (const v of vehicles) {
    const plate = String(v.plateNo).replace(/\s+/g, '');
    const r = await lookup(session, plate);
    if (r) {
      found += 1;
      if (r.to !== v.inspectionValidity?.to || r.from !== v.inspectionValidity?.from) changed += 1;
      await Vehicle.updateOne({ _id: v._id }, { $set: { inspectionValidity: { ...r, checkedAt: now } } });
    } else {
      notFound.push(plate);
    }
    await new Promise((ok) => setTimeout(ok, 400));
  }
  return { checked: vehicles.length, found, changed, notFound };
};
