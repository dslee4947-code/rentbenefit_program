/**
 * 계약서 A4 한 쪽(210mm × 297mm). 스킬 contract-a4-pdf의 PageFrame 규칙 그대로.
 *
 * - 2쪽부터 우상단 머리: ㈜렌트베네핏 / 계약번호 / ※ 계약번호가 없는 계약서는 무효입니다.
 * - 1쪽(표지, cover)은 머리 없이 큰 로고·제목이 들어간다.
 * - 하단 중앙 꼬리: n/12
 * 쪽 크기·여백·넘침 잘림·쪽 나눔은 print.css의 .page가 정한다.
 *
 * @param {{no: number, total?: number, contractNo?: string, cover?: boolean, children?: React.ReactNode}} props
 */
function PageFrame({ no, total = 12, contractNo, cover = false, children }) {
  return (
    <section className="page" data-page={no}>
      {!cover && (
        <div className="page-header">
          <div className="company">㈜렌트베네핏</div>
          <div className="contract-no">계약번호: {contractNo ?? ''}</div>
          <div className="notice">※ 계약번호가 없는 계약서는 무효입니다.</div>
        </div>
      )}
      {children}
      <div className="page-footer">{no}/{total}</div>
    </section>
  );
}

export default PageFrame;
