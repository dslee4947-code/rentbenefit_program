// 렌트 차량 AS에 올리는 서류(자동차검사 결과·수리 내역서)를 읽어 기록에 넣는다.
// 달력 일정 창과 [서류 올리기]가 같은 함수를 쓴다. 읽은 값은 칸을 채울 뿐이고, 저장은 사람이 확인한 뒤 한다.

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

export const READ_SOURCE = { 'pdf-text': 'PDF 글자', xlsx: '엑셀', clova: '사진·스캔 글자 인식(OCR)', text: '고친 글자' };
export const DOC_LABEL = { inspection: '자동차검사 서류', repair: '수리·점검 내역서' };

// 내역서 작업 줄 이름으로 바꾼 소모품을 짚는다. 에어컨 필터를 에어필터보다 먼저 본다.
const CONSUMABLE_WORDS = [
  ['엔진오일·오일필터', /엔진\s*오일|오일\s*필터/],
  ['에어컨 필터', /에어컨\s*(필터|휠터)|항균\s*필터|캐빈\s*필터/],
  ['에어필터', /에어\s*(필터|클리너|크리너)|공기\s*필터/],
  ['브레이크 패드(앞)', /(앞|프론트|FR).{0,6}패드|패드.{0,4}(앞|프론트|FR)/i],
  ['브레이크 패드(뒤)', /(뒤|리어|RR).{0,6}패드|패드.{0,4}(뒤|리어|RR)/i],
  ['브레이크 오일', /브레이크\s*(오일|액)/],
  ['타이어', /타이어/],
  ['와이퍼', /와이퍼/],
  ['배터리', /배터리|밧데리/],
  ['냉각수', /냉각수|부동액/]
];

/** 작업 줄 이름으로 바꾼 소모품 목록. 금액이 있는 줄만 본다(법정 견적서의 '배터리 양호' 같은 점검 줄을 빼려고) */
export const consumablesOf = (lines) => CONSUMABLE_WORDS
  .filter(([, re]) => (lines || []).some((l) => re.test(l.name) && (!('amount' in l) || Number(l.amount) > 0)))
  .map(([c]) => c);

/**
 * 파일을 서버에서 읽는다.
 * @param {File} file 서류
 * @param {string} [vehicleId] 일정 창처럼 차가 정해져 있으면. 없으면 서류의 차량번호로 찾는다
 * @returns {Promise<{source, text, parsed, kind, vehicle, target}>}
 */
export const readServiceDoc = async (file, vehicleId) => {
  const fd = new FormData();
  fd.append('file', file);
  if (vehicleId) fd.append('vehicleId', vehicleId);
  const res = await fetch(`${API_HOST}/api/vehicle-services/read-document`, { method: 'POST', body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.message || '서류를 읽지 못했습니다.');
  return data;
};

/** 차·종류·날짜로 넣을 일정을 다시 찾는다 */
export const matchServiceTarget = async ({ vehicleId, kind, date }) => {
  const q = new URLSearchParams({ vehicleId, kind, date: date || '' });
  const res = await fetch(`${API_HOST}/api/vehicle-services/match?${q}`, { cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  return data.success ? data.target : null;
};

/** 서류에서 읽은 값 → 기록 칸. 부적합이면 완료로 두지 않는다(완료면 다음 검사가 다음 해로 넘어간다) */
export const fieldsFromDoc = ({ parsed, text }) => {
  const isInspection = parsed.docType === 'inspection';
  const summary = isInspection
    ? ['자동차검사', parsed.result, parsed.nextDate ? `다음 검사 ${parsed.nextDate}` : ''].filter(Boolean).join(' · ')
    : (parsed.lines || []).map((l) => l.name).join(', ');
  const extra = isInspection
    ? { inspection: { result: parsed.result || '', nextDate: parsed.nextDate || '' } }
    : {
      lines: parsed.lines || [],
      consumables: consumablesOf(parsed.lines),
      invoice: {
        bizNo: parsed.bizNo, issuedDate: parsed.issuedDate, partsTotal: parsed.partsTotal, laborTotal: parsed.laborTotal,
        supply: parsed.supply, vat: parsed.vat, discount: parsed.discount, total: parsed.total, text
      },
      ...(parsed.supply || parsed.vat ? { costs: { repair: parsed.supply, vat: parsed.vat } } : {})
    };
  return {
    date: parsed.date || '',
    status: parsed.result === '부적합' ? '입고' : '완료',
    shop: parsed.shop || '',
    mileage: parsed.mileage || '',
    amount: parsed.amount || '',
    description: summary,
    extra
  };
};

/**
 * 서류 내용을 기록으로 저장하고 파일을 붙인다. recordId가 있으면 그 일정에, 없으면 새 기록으로.
 * 비어 있는 값으로 기존 칸을 지우지 않는다.
 *
 * @param {object} p
 * @param {string} p.vehicleId 차
 * @param {string} [p.recordId] 넣을 기존 기록
 * @param {string} p.kind 종류
 * @param {object} p.fields 기록 칸(date, status, shop, mileage, amount, description, extra)
 * @param {File[]} p.files 붙일 파일
 * @returns {Promise<string>} 파일을 못 붙였으면 그 안내, 아니면 ''
 */
export const saveServiceDoc = async ({ vehicleId, recordId, kind, fields, files }) => {
  const f = fields;
  const body = {
    kind, date: f.date, status: f.status, ...(f.extra || {}),
    ...(f.shop ? { shop: f.shop } : {}),
    ...(f.mileage ? { mileage: f.mileage, mileageOut: f.mileage } : {}),
    ...(f.amount ? { amount: f.amount } : {}),
    ...(f.description ? { description: f.description } : {})
  };
  if (!recordId) {
    const fd = new FormData();
    fd.append('vehicleId', vehicleId);
    fd.append('kind', kind);
    fd.append('data', JSON.stringify(body));
    files.forEach((x) => fd.append('files', x));
    const data = await fetch(`${API_HOST}/api/vehicle-services`, { method: 'POST', body: fd }).then((r) => r.json());
    if (!data.success) throw new Error(data.message || '저장하지 못했습니다.');
    return '';
  }
  const res = await fetch(`${API_HOST}/api/vehicle-services/${recordId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }).then((r) => r.json());
  if (!res.success) throw new Error(res.message || '저장하지 못했습니다.');
  return attachServiceFiles(recordId, files);
};

/** 기존 기록에 파일을 붙인다. 내용은 이미 저장했으니 실패해도 안내만 돌려준다 */
export const attachServiceFiles = async (recordId, files) => {
  if (!files?.length) return '';
  const fd = new FormData();
  files.forEach((x) => fd.append('files', x));
  const up = await fetch(`${API_HOST}/api/vehicle-services/${recordId}/files`, { method: 'POST', body: fd }).then((r) => r.json()).catch(() => ({}));
  return up.success ? '' : (up.message || '파일을 붙이지 못했습니다. 내용은 저장했습니다.');
};

/** 저장된 서류 파일을 새 창으로 연다. 창을 먼저 열어 두지 않으면 팝업 차단에 걸린다 */
export const openServiceFile = async (recordId, i, showToast) => {
  const win = window.open('', '_blank');
  try {
    const res = await fetch(`${API_HOST}/api/vehicle-services/${recordId}/file${i !== undefined ? `?i=${i}` : ''}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      win?.close();
      showToast?.(data.message || '파일을 열지 못했습니다.', 'error');
      return;
    }
    const url = URL.createObjectURL(await res.blob());
    if (win) win.location.href = url; else window.location.assign(url);
  } catch {
    win?.close();
    showToast?.('서버 통신 오류가 발생했습니다.', 'error');
  }
};
