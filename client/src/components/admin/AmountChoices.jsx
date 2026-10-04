// 고지서에서 읽은 금액 후보를 버튼으로 늘어놓는다. 청구서 화면과 여러 장 올리기가 함께 쓴다.

const won = (n) => `${Number(n || 0).toLocaleString()}원`;

/**
 * 읽은 금액 후보. 누르면 그 금액으로 바꾼다.
 *
 * 과태료는 가산금 전·후 금액이, 통행료는 원금·부가통행료·합계가 함께 적혀 있어
 * 서버가 고른 값이 틀릴 때 칸을 지우고 다시 치는 대신 한 번 눌러 고치게 한다.
 * 부가통행료는 청구하지 않으므로 누를 수 없게 둔다.
 */
export default function AmountChoices({ candidates = [], value, onPick, surcharge = 0 }) {
  const list = candidates.filter((c) => c.amount);
  if (!list.length && !surcharge) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', alignItems: 'center' }}>
      {list.map((c) => {
        const isSurcharge = c.label === '부가통행료';
        const active = Number(value) === c.amount;
        return (
          <button
            key={`${c.label}-${c.amount}`}
            type="button"
            disabled={isSurcharge}
            onClick={() => onPick(c.amount)}
            title={isSurcharge ? '부가통행료는 청구하지 않습니다 (원금만 청구)' : `${c.label} 금액으로 바꿉니다`}
            style={{
              padding: '0.1rem 0.45rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 700,
              border: `1px solid ${active ? 'var(--primary)' : 'var(--border-color)'}`,
              background: active ? 'var(--primary)' : '#fff',
              color: active ? '#fff' : (isSurcharge ? 'var(--text-muted)' : 'var(--text-main)'),
              textDecoration: isSurcharge ? 'line-through' : 'none',
              cursor: isSurcharge ? 'not-allowed' : 'pointer'
            }}
          >
            {c.label === '원' ? '' : `${c.label} `}{won(c.amount)}
          </button>
        );
      })}
      {surcharge > 0 && (
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>부가통행료 {won(surcharge)}는 청구하지 않습니다</span>
      )}
    </div>
  );
}
