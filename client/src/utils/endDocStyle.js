/**
 * 중도해지 정산서 · 중도해지 안내문 · 계약종료 확인서가 함께 쓰는 값(색, 칸 모양, 숫자 표기). 모양 부품은 components/admin/EndDocParts.jsx.
 */

export const PAGE_W = 794;
export const PAGE_H = 1120;

export const NAVY = '#1f3864';
export const RED = '#c00000';
export const LABEL_BG = '#f2f2f2';
export const HEAD_BG = '#7f7f7f';
export const SUB_BG = '#dce6f1';
export const NOTE_BG = '#fff2cc';
export const LINE = '1px solid #bfbfbf';

export const COMPANY = '㈜렌트베네핏';
export const num = (n) => Math.round(Number(n) || 0).toLocaleString('ko-KR');
export const won = (n) => `${num(n)}원`;
export const korDate = (ymd) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
  return m ? `${m[1]}년 ${Number(m[2])}월 ${Number(m[3])}일` : '';
};

/** 이름 칸·값 칸. 모든 표가 이 칸을 쓴다 */
export const labelCell = { background: LABEL_BG, border: LINE, fontWeight: 700, fontSize: '12.5px', textAlign: 'center', padding: '0 6px', height: '25px', lineHeight: 1.25 };
export const valueCell = { border: LINE, fontSize: '12.5px', textAlign: 'center', padding: '0 8px', height: '25px', lineHeight: 1.25 };
export const moneyCell = { ...valueCell, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
export const headCell = { background: HEAD_BG, color: '#fff', border: LINE, fontWeight: 700, fontSize: '12px', textAlign: 'center', padding: '0 6px', height: '25px' };
export const subCell = { background: SUB_BG, border: LINE, fontWeight: 700, fontSize: '13px', textAlign: 'center', padding: '0 8px', height: '27px' };
export const tableStyle = { width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' };
