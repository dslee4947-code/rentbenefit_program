import { useMemo } from 'react';
import ContractSheetPage from './ContractSheetPage.jsx';
import { buildSheetContext } from './contractSheetUtils.js';

/**
 * 약관 원문 '장별 전체'를 A4 문서로 보여 준다(인쇄·PDF 그대로).
 *
 * - 약관 장(계약서_6~12): 엑셀 폭에 맞춰 끊긴 줄을 이어 붙인 글을 엑셀 모양으로 다시 짠다.
 *   머리(㈜렌트베네핏), 빨간 제목, 회색 조항 제목 막대, 두 단은 엑셀과 같게 두고 글자만 읽기 좋은 크기로 키운다.
 * - 표로 된 장(위임장, 계약서_1~5, 보증금 안내문): 줄을 이을 글이 아니라 표라서 엑셀 화면을 빈 양식으로 그대로 넣는다.
 *
 * 장마다 새 쪽에서 시작한다. 글이 길면 다음 쪽으로 이어진다.
 */

const A4_DOC_WIDTH = 760; // 여백 10mm를 뺀 A4 폭(약 718px)에 맞춰 printFitted가 줄인다
const A4_PAGE_HEIGHT = Math.round(A4_DOC_WIDTH * (297 / 210));

const levelStyle = (level) => {
  const indent = Math.max(0, Number(level) || 0) * 12;
  // 항목 기호가 있는 문단은 내어쓰기: 첫 줄은 기호 자리만큼 왼쪽으로, 이어지는 줄은 기호 뒤에 맞춘다
  return level ? { paddingLeft: indent + 14, textIndent: -14 } : {};
};

function TermsItems({ items }) {
  return items.map((it, i) => {
    if (it.kind === 'heading') {
      return <div key={i} className="terms-heading" style={{ background: '#d9d9d9', fontWeight: 800, fontSize: 12.5, padding: '3px 6px', margin: '10px 0 5px', breakInside: 'avoid', breakAfter: 'avoid' }}>{it.text}</div>;
    }
    if (it.kind === 'title') {
      return <div key={i} style={{ columnSpan: 'all', textAlign: 'center', color: '#e00000', fontWeight: 900, fontSize: 22, margin: '4px 0 2px' }}>{it.text}</div>;
    }
    if (it.kind === 'subtitle') {
      return <div key={i} style={{ columnSpan: 'all', textAlign: 'center', color: '#e00000', fontSize: 13, marginBottom: 8 }}>{it.text}</div>;
    }
    if (it.kind === 'box') {
      return (
        <div key={i} style={{ border: '1px solid #666', padding: '4px 7px', margin: '5px 0', fontSize: 10.5, lineHeight: 1.5, breakInside: 'avoid' }}>
          {it.lines.map((l, j) => <div key={j}>{l}</div>)}
        </div>
      );
    }
    return (
      <p key={i} style={{ margin: '0 0 3px', fontSize: 10.5, lineHeight: 1.6, textAlign: 'left', wordBreak: 'keep-all', fontWeight: it.bold ? 700 : 400, ...levelStyle(it.level) }}>
        {it.text}
      </p>
    );
  });
}

function PageHeader({ sheet }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', borderBottom: '3px solid #bfbfbf', paddingBottom: 3, marginBottom: 10 }}>
      <span style={{ fontSize: 10, color: '#888' }}>{sheet}</span>
      <span style={{ fontSize: 19, fontWeight: 500, letterSpacing: 1 }}>㈜렌트베네핏</span>
    </div>
  );
}

function ContractTermsDocument({ template, readable, mediaUrl, docRef }) {
  const blankCtx = useMemo(() => buildSheetContext(template, {}, null), [template]);
  const sheetByName = useMemo(() => Object.fromEntries((template?.sheets || []).map((s) => [s.name, s])), [template]);

  return (
    <div ref={docRef} className="terms-a4-doc print-fit" style={{ width: A4_DOC_WIDTH, margin: '0 auto', fontFamily: "'맑은 고딕', 'Malgun Gothic', sans-serif", color: '#111' }}>
      {readable.pages.map((page) => {
        const sheet = sheetByName[page.sheet];
        const pageBox = { background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.12)', marginBottom: 16, padding: '26px 30px', minHeight: A4_PAGE_HEIGHT, boxSizing: 'border-box' };
        if (!page.terms && sheet) {
          // 표로 된 장: 엑셀 화면 그대로(빈 양식) A4 폭에 맞춰 줄인다
          const w = sheet.cols.reduce((a, b) => a + b, 0) + 60;
          const scale = Math.min(1, (A4_DOC_WIDTH - 60) / w);
          return (
            <section key={page.sheet} className="terms-a4-page" style={pageBox}>
              <div style={{ fontSize: 10, color: '#888', marginBottom: 4 }}>{page.sheet}</div>
              <div style={{ zoom: scale }}>
                <ContractSheetPage sheet={sheet} styles={template.styles} ctx={blankCtx} mediaUrl={mediaUrl} />
              </div>
            </section>
          );
        }
        return (
          <section key={page.sheet} className="terms-a4-page" style={pageBox}>
            <PageHeader sheet={page.sheet} />
            <div style={{ columnCount: page.twoColumn ? 2 : 1, columnGap: 22 }}>
              <TermsItems items={page.items} />
            </div>
          </section>
        );
      })}
    </div>
  );
}

export default ContractTermsDocument;
