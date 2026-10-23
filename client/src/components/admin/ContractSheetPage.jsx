import { memo } from 'react';
import { resolveBinding } from './contractSheetUtils.js';

/**
 * 전자계약서 엑셀 양식의 한 장(시트)을 화면에 그대로 그린다.
 *
 * 서버가 엑셀을 읽어 둔 결과(칸 너비·높이, 병합, 셀 모양, 글상자, 그림)만으로 그린다.
 * 셀은 표 대신 절대 위치로 놓는다. 엑셀처럼 병합 칸과 글상자가 칸 경계를 넘나들기 때문이다.
 * 빈칸 수식(=법인정보!B4 등)은 계약서 입력값(values)으로 바꿔 넣는다.
 */

const ptToPx = (pt) => (pt * 4) / 3;

const BORDER = {
  thin: '1px solid', hair: '1px solid', dotted: '1px dotted', dashed: '1px dashed', dashDot: '1px dashed',
  dashDotDot: '1px dashed', mediumDashed: '2px dashed', mediumDashDot: '2px dashed', slantDashDot: '2px dashed',
  medium: '2px solid', thick: '3px solid', double: '3px double'
};
const borderCss = (spec) => {
  if (!spec) return undefined;
  const [style, color] = spec.split('|');
  const base = BORDER[style] || '1px solid';
  return `${base} ${style === 'hair' ? '#c0c0c0' : color || '#000'}`;
};

const ARROW_CLIP = {
  rightArrow: 'polygon(0 30%, 62% 30%, 62% 0, 100% 50%, 62% 100%, 62% 70%, 0 70%)',
  stripedRightArrow: 'polygon(0 30%, 62% 30%, 62% 0, 100% 50%, 62% 100%, 62% 70%, 0 70%)',
  leftArrow: 'polygon(100% 30%, 38% 30%, 38% 0, 0 50%, 38% 100%, 38% 70%, 100% 70%)',
  downArrow: 'polygon(30% 0, 70% 0, 70% 62%, 100% 62%, 50% 100%, 0 62%, 30% 62%)',
  upArrow: 'polygon(30% 100%, 70% 100%, 70% 38%, 100% 38%, 50% 0, 0 38%, 30% 38%)'
};

const colIndex = (letters) => letters.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
/** "'시트'!$A$1:$AD$50" → 범위 */
const parseArea = (ref) => {
  const m = /\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/.exec(String(ref || '').split(',')[0]);
  return m ? { c1: colIndex(m[1]), r1: Number(m[2]) - 1, c2: colIndex(m[3]), r2: Number(m[4]) - 1 } : null;
};

function ContractSheetPage({ sheet, styles, ctx, mediaUrl, highlightKey }) {
  const area = parseArea(sheet.printArea) || { c1: 0, r1: 0, c2: sheet.cols.length - 1, r2: sheet.rows.length - 1 };
  // 인쇄 영역이 없는 장(보증금 안내문: 446줄)은 글·그림이 있는 마지막 줄까지만 그린다
  if (!sheet.printArea) {
    const lastRow = Math.max(
      ...sheet.cells.filter((c) => c.t !== undefined || c.bind).map((c) => c.r),
      ...sheet.shapes.map((s) => (s.to ? s.to.r : s.from.r)),
      0
    );
    area.r2 = Math.min(area.r2, lastRow + 2);
  }

  const colX = [0];
  for (let c = area.c1; c <= area.c2; c += 1) colX.push(colX[colX.length - 1] + (sheet.cols[c] ?? 64));
  const rowY = [0];
  for (let r = area.r1; r <= area.r2; r += 1) rowY.push(rowY[rowY.length - 1] + (sheet.rows[r] ?? 20));
  const width = colX[colX.length - 1];
  const height = rowY[rowY.length - 1];
  const x = (c, dx = 0) => (colX[Math.max(0, Math.min(c - area.c1, colX.length - 1))] ?? 0) + dx;
  const y = (r, dy = 0) => (rowY[Math.max(0, Math.min(r - area.r1, rowY.length - 1))] ?? 0) + dy;

  // 병합: 왼쪽 위 칸이 전체 크기를 갖고, 나머지 칸은 그리지 않는다
  const mergeAt = new Map();
  const covered = new Set();
  for (const [r1, c1, r2, c2] of sheet.merges) {
    mergeAt.set(`${r1}:${c1}`, { r2, c2 });
    for (let r = r1; r <= r2; r += 1) for (let c = c1; c <= c2; c += 1) if (r !== r1 || c !== c1) covered.add(`${r}:${c}`);
  }

  const cells = sheet.cells.filter((c) => c.r >= area.r1 && c.r <= area.r2 && c.c >= area.c1 && c.c <= area.c2 && !covered.has(`${c.r}:${c.c}`));

  // 엑셀처럼, 줄바꿈 없는 글은 옆 칸이 비어 있을 때만 넘쳐 보이고 옆 칸에 글이 있으면 잘린다
  const filled = new Set(cells.filter((c) => (c.bind ? resolveBinding(c.bind, ctx) : c.t)).map((c) => `${c.r}:${c.c}`));
  // 글이 든 병합 칸은 그 범위 전체를 '글 있음'으로 본다
  for (const [r1, c1, r2, c2] of sheet.merges) {
    if (!filled.has(`${r1}:${c1}`)) continue;
    for (let r = r1; r <= r2; r += 1) for (let c = c1; c <= c2; c += 1) filled.add(`${r}:${c}`);
  }
  const nextFilled = (r, from, dir) => {
    for (let c = from + dir; c >= area.c1 && c <= area.c2; c += dir) if (filled.has(`${r}:${c}`)) return c;
    return null;
  };

  return (
    <div className="contract-sheet-page" style={{ position: 'relative', width, height, background: '#fff', overflow: 'visible', fontFamily: "'맑은 고딕', 'Malgun Gothic', sans-serif", color: '#000' }}>
      {cells.map((cell) => {
        const st = styles[cell.s] || {};
        const m = mergeAt.get(`${cell.r}:${cell.c}`);
        const r2 = Math.min(m ? m.r2 : cell.r, area.r2);
        const c2 = Math.min(m ? m.c2 : cell.c, area.c2);
        const left = x(cell.c);
        const top = y(cell.r);
        const w = x(c2 + 1) - left;
        const h = y(r2 + 1) - top;
        const text = cell.bind ? resolveBinding(cell.bind, ctx) : cell.t ?? '';
        const isField = Boolean(cell.bind);
        const fieldKey = cell.bind?.op === 'ref' && cell.bind.sheet === '법인정보' ? ctx.fieldByCell[cell.bind.cell]?.key : null;
        const wrap = st.wrap || /\n/.test(text);
        const justify = st.h === 'center' || st.h === 'centerContinuous' ? 'center' : st.h === 'right' ? 'flex-end' : 'flex-start';
        // 여러 줄 글은 위에서부터 놓는다. 엑셀 기본(아래 맞춤)대로 두면 글꼴 차이로 칸보다 길어질 때 위로 넘친다
        const align = st.v === 'top' || (wrap && st.v !== 'center') ? 'flex-start' : st.v === 'center' ? 'center' : 'flex-end';
        // 줄바꿈 없는 글이 옆 칸에 글이 있는 쪽으로 넘치지 않게 그 칸까지만 보여 준다
        let clipW = null;
        if (!wrap && text) {
          const dir = st.h === 'right' ? -1 : 1;
          const stop = nextFilled(cell.r, dir > 0 ? c2 : cell.c, dir);
          clipW = stop === null ? null : dir > 0 ? x(stop) - left : left + w - x(stop + 1);
        }
        return (
          <div
            key={cell.a}
            data-field={fieldKey || undefined}
            style={{
              position: 'absolute', left, top, width: w, height: h, boxSizing: 'border-box',
              display: 'flex', alignItems: align, justifyContent: justify,
              background: st.fill || undefined,
              borderLeft: borderCss(st.bl), borderRight: borderCss(st.br), borderTop: borderCss(st.bt), borderBottom: borderCss(st.bb),
              fontSize: ptToPx(st.sz || 11), fontWeight: st.b ? 700 : 400, fontStyle: st.i ? 'italic' : undefined,
              textDecoration: st.u ? 'underline' : undefined, color: st.color || '#000',
              padding: `0 ${2 + (st.indent || 0) * 8}px`, lineHeight: wrap ? 1.15 : 1.25,
              whiteSpace: wrap ? 'pre-wrap' : 'pre', overflow: wrap ? 'hidden' : 'visible',
              textAlign: st.h === 'center' ? 'center' : st.h === 'right' ? 'right' : 'left',
              outline: highlightKey && fieldKey === highlightKey ? '2px solid #2563eb' : undefined,
              zIndex: text ? 1 : 0
            }}
          >
            {text ? (
              <span style={{
                width: wrap ? '100%' : undefined, color: isField && !text.trim() ? '#999' : undefined,
                ...(clipW !== null ? { maxWidth: Math.max(clipW - 2, 0), overflow: 'hidden', flexShrink: 0 } : {})
              }}
              >
                {text}
              </span>
            ) : null}
          </div>
        );
      })}

      {sheet.shapes.map((sh, i) => {
        const left = x(sh.from.c, sh.from.dx);
        const top = y(sh.from.r, sh.from.dy);
        const w = sh.to ? x(sh.to.c, sh.to.dx) - left : sh.size?.w || 100;
        const h = sh.to ? y(sh.to.r, sh.to.dy) - top : sh.size?.h || 40;
        if (sh.from.r > area.r2 || sh.from.c > area.c2) return null;
        // 묶음 도형은 안의 도형마다 앵커 대비 비율 위치(fx, fy, fw, fh)를 갖는다
        return (sh.items || []).map((it, j) => {
          const l = left + it.fx * w;
          const t = top + it.fy * h;
          const iw = it.fw * w;
          const ih = it.fh * h;
          const key = `sh${i}-${j}`;
          if (it.image) {
            return <img key={key} src={mediaUrl(it.image)} alt="" style={{ position: 'absolute', left: l, top: t, width: iw, height: ih, objectFit: 'fill', zIndex: 2 }} />;
          }
          if (it.line) {
            // 연결선: 가로선·세로선만 그린다(양식의 밑줄·구분선)
            const horizontal = ih <= iw;
            return (
              <div key={key} style={{
                position: 'absolute', left: l, top: t, width: horizontal ? iw : 0, height: horizontal ? 0 : ih,
                borderTop: horizontal ? `1px solid ${it.color || '#000'}` : undefined,
                borderLeft: horizontal ? undefined : `1px solid ${it.color || '#000'}`, zIndex: 2
              }}
              />
            );
          }
          const valign = it.anchor === 'ctr' ? 'center' : it.anchor === 'b' ? 'flex-end' : 'flex-start';
          // 서명 자리를 가리키는 화살표 같은 모양은 모양 그대로 자른다(사각형으로 그리면 글을 덮는다)
          const clipPath = ARROW_CLIP[it.geom];
          return (
            <div
              key={key}
              style={{
                position: 'absolute', left: l, top: t, width: Math.max(iw, 4), height: Math.max(ih, 4), boxSizing: 'border-box',
                border: it.box && !clipPath ? `1px solid ${it.color || '#555'}` : undefined, background: it.fill || undefined,
                opacity: it.alpha ?? undefined, clipPath,
                borderRadius: it.geom === 'ellipse' ? '50%' : it.geom === 'roundRect' ? 6 : undefined,
                display: 'flex', flexDirection: 'column', justifyContent: valign,
                fontSize: 12, lineHeight: 1.2, padding: '1px 3px', zIndex: 3, whiteSpace: 'pre-wrap', overflow: 'visible'
              }}
            >
              {(it.paragraphs || []).map((p, k) => (
                <div key={k} style={{ textAlign: p.algn === 'ctr' ? 'center' : p.algn === 'r' ? 'right' : 'left', fontSize: p.sz ? ptToPx(p.sz) : undefined, fontWeight: p.b ? 700 : undefined, minHeight: '1em' }}>
                  {p.text}
                </div>
              ))}
            </div>
          );
        });
      })}
    </div>
  );
}

export default memo(ContractSheetPage);
