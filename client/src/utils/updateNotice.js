/**
 * 새 버전 알림.
 *
 * 이 프로그램은 한 번 열리면 화면 안에서만 움직여서, 핸드폰처럼 탭을 오래 열어 두면
 * 새로 배포해도 예전 화면을 계속 보여 준다(대표님 2026-10-21 "다시 들어가면 수정이 안 되어 있다").
 * 화면으로 돌아올 때와 10분마다 서버의 첫 페이지를 확인해, 실행 파일 이름이 바뀌었으면
 * 화면 아래에 [새로고침] 띠를 띄운다. 쓰던 내용을 잃지 않게 자동으로 새로고치지는 않는다.
 */
const scriptNameOf = (html) => (html.match(/\/assets\/index-[^"']+\.js/) || [])[0] || null;

export function installUpdateNotice() {
  if (import.meta.env.DEV) return; // 개발 서버는 바로바로 반영된다
  const current = scriptNameOf(document.documentElement.innerHTML);
  if (!current) return;
  let shown = false;

  const show = () => {
    if (shown) return;
    shown = true;
    const bar = document.createElement('div');
    bar.className = 'no-print';
    bar.style.cssText = [
      'position:fixed', 'left:12px', 'right:12px', 'bottom:calc(12px + env(safe-area-inset-bottom, 0px))', 'z-index:3000',
      'display:flex', 'align-items:center', 'justify-content:space-between', 'gap:10px',
      'padding:12px 14px', 'border-radius:10px', 'background:#1e3a8a', 'color:#fff',
      'font-size:14px', 'font-weight:700', 'box-shadow:0 6px 20px rgba(0,0,0,0.25)'
    ].join(';');
    bar.innerHTML = '<span>새 버전이 올라왔습니다.</span>';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '새로고침';
    btn.style.cssText = 'border:none;border-radius:8px;padding:8px 14px;background:#fff;color:#1e3a8a;font-weight:800;font-size:14px;cursor:pointer';
    btn.onclick = () => window.location.reload();
    bar.appendChild(btn);
    document.body.appendChild(bar);
  };

  const check = async () => {
    if (shown) return;
    try {
      const html = await fetch(`/?v=${Date.now()}`, { cache: 'no-store' }).then((r) => r.text());
      const latest = scriptNameOf(html);
      if (latest && latest !== current) show();
    } catch { /* 연결이 잠깐 끊겨도 다음에 다시 본다 */ }
  };

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  window.addEventListener('focus', check);
  setInterval(check, 10 * 60 * 1000);
}
