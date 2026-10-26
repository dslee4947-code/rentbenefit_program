/**
 * 연장 계약 꼬리표. 청구 화면·발송 센터에서 계약번호 옆에 붙인다.
 * 연장 계약은 회차가 1부터 다시 시작해 새 계약으로 헷갈리기 쉽다(대표님 2026-10-26, 계약 연장 절차 1차).
 *
 * @param {object} props
 * @param {object} [props.contract] populate된 계약(contractKind, extensionInfo)
 */
function ExtensionTag({ contract }) {
  if (contract?.contractKind !== '연장') return null;
  const prev = contract.extensionInfo?.previousContractNo;
  return (
    <span
      title={prev ? `연장 계약 · 이전 계약 ${prev}${contract.extensionInfo?.previousLastRound ? ` ${contract.extensionInfo.previousLastRound}회 다음` : ''}` : '연장 계약'}
      style={{ marginLeft: '0.3rem', fontSize: '0.68rem', fontWeight: 800, color: '#7c3aed', border: '1px solid #c4b5fd', background: '#f5f3ff', borderRadius: '4px', padding: '0 0.3rem', whiteSpace: 'nowrap' }}
    >
      연장
    </span>
  );
}

export default ExtensionTag;
