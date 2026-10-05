import XLSX from 'xlsx';
import { pickCompanyAccount } from '../../shared/companyAccounts.js';

/**
 * 자금팀 엑셀 "렌트베네핏 입출금 리스트"를 회사 장부 줄로 바꾼다.
 *
 * 엑셀 모양 (2026-10 기준 시트 6장)
 * - 고정비용·부대비용·기타비용: 1행에 칸 제목, 6행에 "내역/금액/날짜", 7행부터 데이터. 칸 하나가 3열(내역·금액·날짜).
 *   금액이 마이너스면 돌려받은 돈(환급)이다.
 * - 은행대출: 대출마다 4열(잔액·이자·이율·날짜). 금액은 그 달 낸 이자다. 원금 상환은 이 시트에 없다.
 *   "정기 적금"은 3열(내역·금액·날짜, 금액은 −1,000,000처럼 마이너스로 적힘),
 *   "렌터카 공제조합"은 4열(차량·대출금·은행·날짜)로 차량별 대출 실행이다.
 * - 대표 차입금: 왼쪽(적요·금액·날짜)이 회사가 갚은 돈, 오른쪽(적요·금액·일자)이 대표님이 넣은 돈. "자본금"은 빌린 돈이 아니라 자본금이다.
 * - 부가세: 왼쪽이 낸 돈, 오른쪽이 환급받은 돈. 법인세·지방세 줄이 섞여 있는데 기타비용 '법인세' 칸과 같은 줄이라 두 번 세지 않게 뺀다.
 *
 * 엑셀을 다시 올려도 같은 줄이 두 번 들어가지 않게 줄마다 importKey(시트|칸|내역|금액|날짜|같은 줄 순번)를 붙인다.
 */

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const DAY = 86400000;

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const ymd = (d) => d.toISOString().slice(0, 10);

/** 엑셀 날짜(일련번호 또는 "2022-02-28" 글자)를 Date로. 2022-02-29 같은 없는 날짜는 null. */
const toDate = (v) => {
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(EXCEL_EPOCH + Math.round(v) * DAY);
  const m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/.exec(clean(v));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCMonth() === +m[2] - 1 ? d : null;
};

const toAmount = (v) => {
  if (typeof v === 'number') return v;
  const s = clean(v).replace(/,/g, '');
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
};

/** 엑셀에서 쓰는 "-" 자리 표시, 빈 줄 */
const isBlank = (...vals) => vals.every((v) => ['', '-'].includes(clean(v)));

const readRows = (ws) => XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });

/** 1행 칸 제목 위치를 모은다. 다음 제목 전까지가 그 칸이다. */
const headerBlocks = (rows) => {
  const head = rows[0] || [];
  const width = Math.max(...rows.map((r) => r.length));
  const starts = [];
  head.forEach((v, i) => { if (clean(v)) starts.push(i); });
  return starts.map((start, i) => ({ title: clean(head[start]), start, end: (starts[i + 1] ?? width) - 1 }));
};

/**
 * @param {Buffer} buffer 엑셀 파일
 * @returns {{ rows: object[], skipped: object[], sheets: string[] }}
 *   rows: 장부에 넣을 줄. excluded=true는 다른 줄과 겹쳐 합계에서 빼는 줄(그래도 화면에서는 보이게 넣는다)
 *   skipped: 금액이나 날짜를 못 읽어 넣지 않은 줄(사람이 엑셀을 고쳐야 함)
 */
export const parseCompanyBookWorkbook = (buffer) => {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const rows = [];
  const skipped = [];

  const push = ({ sheet, column, rowNo, description, amount, date, direction, account, memo = '' }) => {
    rows.push({
      date, direction, amount: Math.abs(amount), account, description, memo,
      sourceSheet: sheet, sourceColumn: column, sourceRow: rowNo
    });
  };
  const skip = (sheet, column, rowNo, cells, reason) => skipped.push({ sheet, column, row: rowNo, text: cells.map(clean).filter(Boolean).join(' / '), reason });

  // 내역·금액·날짜 3칸을 읽는 공통 처리. 금액 마이너스는 들어온 돈.
  const readTriplet = ({ sheet, column, rowNo, desc, amt, dt, account, outward = true }) => {
    if (isBlank(desc, amt, dt)) return;
    const amount = toAmount(amt);
    const date = toDate(dt);
    if (amount === null || amount === 0) {
      // 내역만 적고 금액을 비워 둔 줄(예: "다솔 월 기장료" 다음 달 자리)은 아직 안 나간 돈이라 조용히 넘긴다
      if (clean(amt) === '' && clean(dt) === '') return;
      return skip(sheet, column, rowNo, [desc, amt, dt], '금액을 읽을 수 없음');
    }
    if (!date) return skip(sheet, column, rowNo, [desc, amt, dt], '날짜를 읽을 수 없음');
    const positiveIsOut = outward;
    const direction = (amount > 0) === positiveIsOut ? '출금' : '입금';
    push({ sheet, column, rowNo, description: clean(desc) || column, amount, date, direction, account: account ?? pickCompanyAccount(column, desc) });
  };

  for (const sheet of ['고정비용', '부대비용', '기타비용']) {
    const ws = wb.Sheets[sheet];
    if (!ws) continue;
    const data = readRows(ws);
    for (const block of headerBlocks(data)) {
      for (let r = 6; r < data.length; r++) {
        const row = data[r];
        readTriplet({ sheet, column: block.title, rowNo: r + 1, desc: row[block.start], amt: row[block.start + 1], dt: row[block.start + 2] });
      }
    }
  }

  if (wb.Sheets['은행대출']) {
    const sheet = '은행대출';
    const data = readRows(wb.Sheets[sheet]);
    for (const block of headerBlocks(data)) {
      for (let r = 6; r < data.length; r++) {
        const row = data[r];
        const c = block.start;
        if (/적금/.test(block.title)) {
          // 금액이 −1,000,000으로 적혀 있지만 회사가 적금에 넣은(나간) 돈이다
          // "정기적금"만 적어 둔 앞으로 낼 달 자리는 넘긴다
          if (isBlank(row[c + 1], row[c + 2])) continue;
          const amount = toAmount(row[c + 1]);
          const date = toDate(row[c + 2]);
          if (!amount || !date) { skip(sheet, block.title, r + 1, [row[c], row[c + 1], row[c + 2]], '금액·날짜를 읽을 수 없음'); continue; }
          push({ sheet, column: block.title, rowNo: r + 1, description: clean(row[c]) || '정기적금', amount, date, direction: amount < 0 ? '출금' : '입금', account: 'savings' });
        } else if (/공제조합/.test(block.title)) {
          // 차량 한 대씩 공제조합 대출을 받은 기록: 차량·대출금·은행·날짜
          // "대출이자"만 적어 둔 빈 자리 줄은 넘긴다
          if (isBlank(row[c + 1], row[c + 3])) continue;
          const amount = toAmount(row[c + 1]);
          const date = toDate(row[c + 3]);
          if (!amount || !date) { skip(sheet, block.title, r + 1, [row[c], row[c + 1], row[c + 3]], '금액·날짜를 읽을 수 없음'); continue; }
          push({ sheet, column: block.title, rowNo: r + 1, description: `${block.title} 대출 실행 ${clean(row[c])}`.trim(), amount, date, direction: '입금', account: 'bankLoan', memo: clean(row[c + 2]) ? `은행 ${clean(row[c + 2])}` : '' });
        } else {
          // 은행 대출: 잔액·이자·이율·날짜. 이자가 비어 있는 달은 넘긴다
          if (isBlank(row[c + 1])) continue;
          const amount = toAmount(row[c + 1]);
          const date = toDate(row[c + 3]);
          if (!amount || !date) { skip(sheet, block.title, r + 1, [row[c], row[c + 1], row[c + 3]], '금액·날짜를 읽을 수 없음'); continue; }
          const balance = toAmount(row[c]);
          const rate = toAmount(row[c + 2]);
          const memo = [balance ? `잔액 ${balance.toLocaleString()}원` : '', rate ? `연 ${(rate * 100).toFixed(2)}%` : ''].filter(Boolean).join(', ');
          push({ sheet, column: block.title, rowNo: r + 1, description: `${block.title} 이자`, amount, date, direction: amount > 0 ? '출금' : '입금', account: 'interest', memo });
        }
      }
    }
  }

  // 대표 차입금: 왼쪽 회사 → 대표(갚음), 오른쪽 대표 → 회사(빌림). 7행이 제목, 8행부터 데이터
  if (wb.Sheets['대표 차입금']) {
    const sheet = '대표 차입금';
    const data = readRows(wb.Sheets[sheet]);
    for (let r = 7; r < data.length; r++) {
      const row = data[r];
      readTriplet({ sheet, column: '대표 차입금 상환', rowNo: r + 1, desc: row[1], amt: row[2], dt: row[3], account: 'ownerLoan' });
      if (!isBlank(row[5], row[6], row[7])) {
        const desc = clean(row[5]);
        const before = rows.length;
        readTriplet({ sheet, column: '대표 차입금 입금', rowNo: r + 1, desc, amt: row[6], dt: row[7], account: /자본금/.test(desc) ? 'capital' : 'ownerLoan', outward: false });
        // 오른쪽 맨 끝 "상환 일자"는 그 돈을 언제 갚았는지 적어 둔 것. 갚은 돈은 왼쪽에 따로 적혀 있어 메모로만 남긴다
        const repaid = toDate(data[r][8]);
        if (repaid && rows.length > before) rows[rows.length - 1].memo = `상환 ${ymd(repaid)}`;
      }
    }
  }

  // 부가세: 왼쪽 납부, 오른쪽 환급
  if (wb.Sheets['부가세']) {
    const sheet = '부가세';
    const data = readRows(wb.Sheets[sheet]);
    const vatAccount = (desc) => (/부가세/.test(desc) ? 'vat' : /취득세/.test(desc) ? 'taxDues' : /법인세|지방세/.test(desc) ? 'corpTax' : 'vat');
    for (let r = 7; r < data.length; r++) {
      const row = data[r];
      readTriplet({ sheet, column: '부가세 납부', rowNo: r + 1, desc: row[1], amt: row[2], dt: row[3], account: vatAccount(clean(row[1])) });
      readTriplet({ sheet, column: '부가세 환급', rowNo: r + 1, desc: row[5], amt: row[6], dt: row[7], account: vatAccount(clean(row[5])), outward: false });
    }
  }

  markDuplicates(rows);
  assignImportKeys(rows);
  return { rows, skipped, sheets: wb.SheetNames };
};

/**
 * 부가세 시트의 법인세·지방세 줄은 기타비용 '법인세' 칸에도 같은 금액·날짜로 적혀 있다(예: 법인세 중간예납 71,270원).
 * 부가세 시트 쪽을 합계에서 뺀다. 날짜가 며칠 다르게 적힌 경우가 있어 7일까지 같은 줄로 본다.
 */
const markDuplicates = (rows) => {
  const others = rows.filter((r) => r.sourceSheet !== '부가세');
  for (const row of rows) {
    if (row.sourceSheet !== '부가세' || row.account === 'vat') continue;
    const twin = others.find((o) => o.amount === row.amount && o.direction === row.direction && Math.abs(o.date - row.date) <= 7 * DAY);
    if (twin) {
      row.excluded = true;
      row.excludeReason = `${twin.sourceSheet} '${twin.sourceColumn}' 칸 ${ymd(twin.date)} "${twin.description}"와 같은 줄`;
    }
  }
};

/** 같은 내역·금액·날짜 줄이 한 칸에 여러 번 있을 수 있어(같은 날 주유비 2만 원 두 번) 순번을 붙인다. */
const assignImportKeys = (rows) => {
  const seen = new Map();
  for (const row of rows) {
    const base = [row.sourceSheet, row.sourceColumn, row.description, row.direction, row.amount, ymd(row.date)].join('|');
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    row.importKey = `${base}|${n}`;
  }
};
