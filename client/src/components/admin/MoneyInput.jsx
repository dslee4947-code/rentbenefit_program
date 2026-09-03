import { toCommaString, parseNumber } from '../../utils/format.js';

/**
 * 금액 입력칸.
 *
 * 화면에는 1,234,567처럼 천 단위 콤마로 보여 주고 값은 숫자로 다룬다.
 * <input type="number">는 콤마를 표시할 수 없어 text로 두고,
 * inputMode="numeric"으로 모바일에서 숫자 키패드가 뜨게 한다.
 *
 * onChange를 기존 input과 같은 모양({ target: { value } })으로 불러 주기 때문에
 * 쓰던 핸들러는 그대로 두고 태그만 바꿔 끼우면 된다.
 * 넘어가는 value는 숫자이거나, 비어 있으면 빈 문자열이다.
 */
function MoneyInput({ value, onChange, style, ...rest }) {
  return (
    <input
      type="text"
      inputMode="numeric"
      value={toCommaString(value)}
      onChange={(e) => onChange({ target: { value: parseNumber(e.target.value) } })}
      style={{ textAlign: 'right', ...style }}
      {...rest}
    />
  );
}

export default MoneyInput;
