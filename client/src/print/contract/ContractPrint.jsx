import { useEffect, useRef, useState } from 'react';
import PageFrame from './components/PageFrame.jsx';
import { printFitted } from '../../utils/printFit.js';
import '../print.css';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

/**
 * 자동차 임대차 계약서 A4 12쪽 (#/contracts/:id/print). 스킬 .claude/skills/contract-a4-pdf.
 *
 * 1단계: 빈 12쪽 + PageFrame(머리·꼬리) + 글꼴. 쪽별 내용(pages/01_Cover ~ 12_SpecialTerms)은 다음 단계에서 채운다.
 *
 * 인쇄는 CLAUDE.md 규칙대로 printFitted를 쓴다(window.print를 직접 부르지 않는다).
 * 쪽이 이미 210mm라 배율은 1에 가깝고(0.997 정도), 여백은 .page 안쪽 padding이므로 marginMm 0.
 */
const TOTAL = 12;

function ContractPrint({ contractId }) {
  const [contract, setContract] = useState(null);
  const [fontReady, setFontReady] = useState(false);
  const pagesRef = useRef(null);

  useEffect(() => {
    let alive = true;
    fetch(`${API_HOST}/api/contracts/${contractId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => { if (alive) setContract(c || {}); })
      .catch(() => { if (alive) setContract({}); });
    // 글꼴을 다 받기 전에 인쇄하면 다른 글꼴로 찍힌다
    Promise.all([document.fonts.load("400 9pt 'Pretendard'"), document.fonts.load("700 9pt 'Pretendard'")])
      .finally(() => { if (alive) setFontReady(true); });
    return () => { alive = false; };
  }, [contractId]);

  const contractNo = contract?.contractNo;
  const close = () => { window.location.hash = '#/contract-docs'; };
  const print = () => printFitted(pagesRef.current, { onePage: false, marginMm: 0, title: `계약서_${contractNo || contractId}` });

  return (
    <div className="print-root">
      <div className="print-toolbar no-print">
        <span style={{ marginRight: 'auto', fontSize: 13 }}>계약번호 {contractNo || '-'} · A4 {TOTAL}쪽</span>
        <button type="button" disabled={!fontReady} onClick={print}>{fontReady ? '인쇄' : '글꼴 준비 중…'}</button>
        <button type="button" onClick={close}>닫기</button>
      </div>
      <div ref={pagesRef} className="print-fit" style={{ width: '210mm', margin: '0 auto' }}>
        {Array.from({ length: TOTAL }, (_, i) => (
          <PageFrame key={i + 1} no={i + 1} total={TOTAL} contractNo={contractNo} cover={i === 0} />
        ))}
      </div>
    </div>
  );
}

export default ContractPrint;
