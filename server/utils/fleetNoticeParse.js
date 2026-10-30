import { PDFParse } from 'pdf-parse';

/**
 * 구청 "자동차대여사업 변경등록신청 처리 알림" PDF 읽기(대표님 2026-10-30 "이게 오면 항상 업로드 해줄께 그러면 최신화를 해줘").
 *
 * 서초구 알림은 모양이 늘 같다.
 *   1. 서초구 민원-117457(2026.10.21.)호 …          → 민원번호, 신청일
 *   ○ 주사무소 승용차 1대 증차(141대 → 142대)       → 증차·감차 대수, 바뀌는 차(차종·차량번호)
 *   합계 141 141 0 142 142 0 455 860 86 369          → 변경 전·후 총대수
 *   시행 교통행정과-126213 ( 2026. 10. 29. )         → 처리일
 */

const PLATE = /\d{2,3}\s?[가-힣]\s?\d{4}/g;
const date = (y, m, d) => new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));

export const parseFleetNoticeText = (text) => {
  const t = String(text || '');
  const out = { minwonNo: '', appliedAt: null, noticeNo: '', processedAt: null, before: null, after: null, increase: 0, decrease: 0, plates: [], summary: '' };

  const minwon = t.match(/민원-([\d,]+)\s*\((\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?\)/);
  if (minwon) {
    out.minwonNo = minwon[1];
    out.appliedAt = date(minwon[2], minwon[3], minwon[4]);
  }
  const notice = t.match(/시행\s*([^\s(]*?-?\d+)\s*\(\s*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?\s*\)/);
  if (notice) {
    out.noticeNo = notice[1];
    out.processedAt = date(notice[2], notice[3], notice[4]);
  }

  // '가. 변경등록 내용'의 ○ 줄부터 '나. 차량 및 차고지 현황' 앞까지가 바뀐 내용
  const start = t.indexOf('○ 주사무소');
  const end = t.indexOf('나. 차량');
  const change = start >= 0 ? t.slice(start, end > start ? end : start + 300) : '';
  // 장기차량 감면 줄은 대수 변경이 아니다(2025-06-11 알림: 감면 대상 27대 번호가 길게 붙어 있다)
  const bullets = change.split('○').map((s) => s.trim()).filter((s) => s && !/장기차량|감면율/.test(s));
  const main = bullets.join(' ○ ');
  out.summary = bullets.length ? `○ ${main.replace(/\s+/g, ' ').replace(/,\s*$/, '').trim()}` : '';
  const inc = main.match(/(\d+)\s*대\s*증차/);
  const dec = main.match(/(\d+)\s*대\s*감차/);
  out.increase = inc ? Number(inc[1]) : 0;
  out.decrease = dec ? Number(dec[1]) : 0;
  out.plates = bullets.filter((b) => b.includes('감차')).flatMap((b) => b.match(PLATE) || []);

  // 변경 전·후 대수: 아래 표의 '합계' 줄과 위 문장의 '(141대 → 142대)'가 가끔 다르다.
  // 증차·감차 대수와 맞는 쪽을 쓰고, 둘 다 맞으면 표를 쓴다(2026-03-31 알림은 문장이 1대씩 적고, 2026-07-15 알림은 표가 바뀌지 않았다).
  const total = t.match(/합계\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/);
  const arrow = main.match(/\(\s*(\d+)\s*대?\s*(?:→|->)\s*(\d+)\s*대\s*\)/);
  const candidates = [
    total && { before: Number(total[1]), after: Number(total[4]) },
    arrow && { before: Number(arrow[1]), after: Number(arrow[2]) }
  ].filter(Boolean);
  const net = out.increase - out.decrease;
  const pick = candidates.find((c) => c.after - c.before === net) || candidates[0];
  if (pick) {
    out.before = pick.before;
    out.after = pick.after;
  }
  return out;
};

export const parseFleetNoticePdf = async (buffer) => {
  const parser = new PDFParse({ data: buffer });
  let text = '';
  try {
    text = (await parser.getText()).text || '';
  } finally {
    await parser.destroy();
  }
  const parsed = parseFleetNoticeText(text);
  if (!parsed.minwonNo || parsed.after == null) {
    throw new Error('구청 처리 알림에서 민원번호나 변경 후 대수를 찾지 못했습니다. 서초구 "자동차대여사업 변경등록신청 처리 알림" PDF가 맞는지 확인해 주세요.');
  }
  return parsed;
};
