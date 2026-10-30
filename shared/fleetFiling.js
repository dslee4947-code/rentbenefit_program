/**
 * 증차·감차 공문 (구청에 내는 자동차대여사업 변경등록신청서).
 *
 * 엑셀 "증차공문 서류_251013.xlsx"를 옮긴 계산이다(대표님 2026-10-30).
 * - 신구사업대비표: 차종마다 재원(가로·세로)·신고 대수·사용면적. 변경 후 칸에는 이번에 늘리거나 줄이는 대수만 적는다.
 * - 신청서: 변경 전·후 총대수, 변경 사유("증차 N대 / 감차 M대").
 * - 차고지: 감면 전 소요면적에서 감면율(90%)만큼 뺀 면적이 재계약 면적 안에 들어가야 한다.
 * 화면(서류 미리보기)과 서버(구청 처리 완료 때 대수 반영)가 같은 규칙을 쓰도록 여기 한 곳에 둔다.
 */

export const FILING_KINDS = ['증차·감차', '차고지 변경', '계약 취소 감차'];
export const FILING_STATUSES = ['작성중', '제출', '처리완료', '취소'];

// 엑셀 '증차' 시트와 신구사업대비표 머리의 값. 기본 정보 칸에서 고친다.
export const DEFAULT_FLEET_INFO = {
  company: {
    name: '주식회사 렌트베네핏',
    phone: '010-2020-3300',
    address: '서울시 서초구 양재대로 11길 36 은관 505호',
    officePhone: '02-546-0303',
    officeAddress: '서울시 서초구 양재대로 11길 36, 은관 505호'
  },
  garage: {
    location: '서울시 강서구 마곡동 797-4',
    area: 455,
    requiredArea: 860,
    reductionRate: 0.9,
    contractArea: 455
  },
  carTypes: []
};

// 차종 이름은 엑셀에서 앞뒤 칸이 섞여 온다(' 모하비'). 같은 차종인지는 칸·대소문자를 빼고 본다.
export const carTypeKey = (name) => String(name || '').replace(/\s+/g, '').toLowerCase();

const num = (v) => Number(v) || 0;
export const areaOf = (width, length, count) => num(width) * num(length) * num(count);

export const defaultReasonOf = (kind, increase, decrease) => {
  if (kind === '차고지 변경') return '차고지 계약에 따른 면적 신고';
  if (kind === '계약 취소 감차') return '계약 취소로 감차 요청';
  return `증차 ${increase}대\n감차 ${Math.abs(decrease)}대`;
};

export const defaultRegistrationLabelOf = (kind, increase, decrease) => {
  if (kind === '차고지 변경') return '차고지 변경';
  if (increase && decrease) return '렌터카 증차·감차';
  if (decrease) return '렌터카 감차';
  return '렌터카 증차';
};

/**
 * 공문 한 건의 신구사업대비표·신청서 값.
 * 기준 대수는 공문에 찍어 둔 것(제출할 때 남김)을 먼저 쓰고, 아직 작성 중이면 지금 신고 대수를 쓴다.
 * @param {{carTypes?: object[], garage?: object}} info 지금 신고 현황
 * @param {{kind?: string, items?: object[], snapshot?: object[], reason?: string, registrationLabel?: string}} filing
 */
export const filingSheetOf = (info, filing = {}) => {
  const base = (filing.snapshot && filing.snapshot.length ? filing.snapshot : info.carTypes) || [];
  const deltas = new Map();
  (filing.items || []).forEach((it) => {
    const key = carTypeKey(it.name);
    if (!key) return;
    const prev = deltas.get(key) || { name: String(it.name).trim(), width: num(it.width), length: num(it.length), delta: 0 };
    prev.delta += num(it.delta);
    if (!prev.width) prev.width = num(it.width);
    if (!prev.length) prev.length = num(it.length);
    deltas.set(key, prev);
  });

  const rows = base.map((t) => {
    const d = deltas.get(carTypeKey(t.name));
    deltas.delete(carTypeKey(t.name));
    const delta = d ? d.delta : 0;
    return {
      name: String(t.name).trim(),
      width: num(t.width),
      length: num(t.length),
      before: num(t.count),
      beforeArea: areaOf(t.width, t.length, t.count),
      delta,
      afterArea: delta ? areaOf(t.width, t.length, delta) : 0
    };
  });
  // 처음 들이는 차종은 표 끝에 붙인다(엑셀에서 맨 아래 줄을 늘리던 것과 같다)
  deltas.forEach((d) => rows.push({
    name: d.name, width: d.width, length: d.length, before: 0, beforeArea: 0, delta: d.delta, afterArea: areaOf(d.width, d.length, d.delta), isNew: true
  }));

  const beforeTotal = rows.reduce((s, r) => s + r.before, 0);
  const increase = rows.reduce((s, r) => s + (r.delta > 0 ? r.delta : 0), 0);
  const decrease = rows.reduce((s, r) => s + (r.delta < 0 ? r.delta : 0), 0);
  const afterTotal = beforeTotal + increase + decrease;
  const beforeArea = rows.reduce((s, r) => s + r.beforeArea, 0);
  const changeArea = rows.reduce((s, r) => s + r.afterArea, 0);

  const g = { ...DEFAULT_FLEET_INFO.garage, ...(info.garage || {}) };
  const reduction = num(g.requiredArea) * num(g.reductionRate);
  const reducedRequired = num(g.requiredArea) - reduction;
  const kind = filing.kind || '증차·감차';

  return {
    rows,
    beforeTotal,
    afterTotal,
    increase,
    decrease,
    beforeArea,
    changeArea,
    garage: {
      ...g,
      reduction,
      reducedRequired,
      remaining: num(g.contractArea) - reducedRequired,
      // 엑셀 AH14: 변경 전 사용면적 − 감면 면적 + 이번에 늘어난 면적
      afterUsedArea: beforeArea - reduction + changeArea
    },
    reason: (filing.reason || '').trim() || defaultReasonOf(kind, increase, decrease),
    registrationLabel: (filing.registrationLabel || '').trim() || defaultRegistrationLabelOf(kind, increase, decrease)
  };
};

/**
 * 구청 처리가 끝난 공문의 대수를 신고 현황에 더한다(sign = -1이면 되돌린다).
 * 없는 차종은 새 줄로 넣고, 대수가 0 아래로 내려가면 이유를 던진다.
 * @returns {object[]} 새 차종 목록
 */
export const applyFilingToCarTypes = (carTypes, items, sign = 1) => {
  const list = (carTypes || []).map((t) => ({ ...t }));
  (items || []).forEach((it) => {
    const delta = num(it.delta) * sign;
    if (!delta) return;
    let t = list.find((x) => carTypeKey(x.name) === carTypeKey(it.name));
    if (!t) {
      if (delta < 0) throw new Error(`${it.name}: 신고된 차종이 아니라 줄일 수 없습니다.`);
      t = { name: String(it.name).trim(), width: num(it.width), length: num(it.length), count: 0 };
      list.push(t);
    }
    t.count = num(t.count) + delta;
    if (t.count < 0) throw new Error(`${t.name}: 신고 대수가 0대 아래로 내려갑니다.`);
  });
  return list;
};
