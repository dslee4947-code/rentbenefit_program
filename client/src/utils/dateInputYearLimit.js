/**
 * 날짜 입력칸의 연도를 네 자리로 막는다.
 *
 * 크롬의 날짜 칸(<input type="date">)은 max가 없으면 연도를 여섯 자리(275760년)까지 받는다.
 * 그래서 20261002를 이어서 치면 연도 칸에 202610이 다 들어가고 월·일로 넘어가지 않아
 * "202610-02-일"이 된다. max에 네 자리 연도(9999-12-31)를 주면 네 자리를 친 순간 월로 넘어가
 * 20261002만 쳐도 2026-10-02가 된다.
 *
 * 날짜 칸이 화면 곳곳(20곳 넘게)에 흩어져 있어 하나씩 고치면 새로 만드는 칸에서 또 빠진다.
 * 그래서 화면에 날짜 칸이 생길 때마다 여기서 max를 붙인다. 이미 max가 있는 칸은 건드리지 않는다.
 */
const LIMITS = {
  date: '9999-12-31',
  'datetime-local': '9999-12-31T23:59',
  month: '9999-12'
};

const SELECTOR = Object.keys(LIMITS).map((t) => `input[type="${t}"]:not([max])`).join(',');

const limit = (input) => {
  const max = LIMITS[input.type];
  if (max && !input.hasAttribute('max')) input.setAttribute('max', max);
};

const scan = (root) => {
  if (root.nodeType !== 1) return;
  if (root.matches(SELECTOR)) limit(root);
  root.querySelectorAll(SELECTOR).forEach(limit);
};

export function installDateInputYearLimit() {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  scan(document.body);
  new MutationObserver((mutations) => {
    mutations.forEach((m) => {
      if (m.type === 'attributes') limit(m.target);
      else m.addedNodes.forEach(scan);
    });
  }).observe(document.body, {
    childList: true,
    subtree: true,
    // 같은 칸이 text -> date로 바뀌는 경우(원장 고정 조건 칸 등)도 잡는다
    attributes: true,
    attributeFilter: ['type']
  });
}
