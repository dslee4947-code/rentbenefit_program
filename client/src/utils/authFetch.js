/**
 * 서버로 나가는 모든 요청에 로그인 토큰을 붙인다.
 *
 * 서버가 이제 로그인한 사람만 데이터를 내주기 때문에, 화면에서 보내는 모든 요청에
 * 토큰이 실려야 한다. 화면마다 fetch를 쓰는 곳이 200군데가 넘어서 하나씩 고치면
 * 빠뜨리는 곳이 생기고, 빠뜨린 화면은 조용히 "권한 없음"으로 비어 보인다.
 * 그래서 fetch를 한 번 감싸서 /api/ 로 나가는 요청에 자동으로 붙인다.
 *
 * 토큰은 로그인할 때 localStorage의 currentUser에 저장된다(App.jsx).
 */

/** 저장된 로그인 정보에서 토큰을 꺼낸다 */
const readToken = () => {
  try {
    const saved = localStorage.getItem('currentUser');
    if (!saved) return null;
    return JSON.parse(saved)?.token || null;
  } catch {
    return null;
  }
};

/** 요청 주소를 문자열로 뽑는다. fetch는 문자열·URL·Request를 모두 받는다. */
const urlOf = (input) => {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input?.url || '';
};

let installed = false;

/**
 * @param {Function} onSessionExpired 토큰이 있는데도 거부당했을 때(만료·탈퇴) 부를 함수
 */
export const installAuthFetch = (onSessionExpired) => {
  if (installed) return;
  installed = true;

  const originalFetch = window.fetch.bind(window);
  let expiredHandled = false;

  window.fetch = async (input, init = {}) => {
    const url = urlOf(input);
    const isApiCall = url.includes('/api/');
    const token = isApiCall ? readToken() : null;

    let options = init;
    if (token) {
      // 이미 들어 있는 헤더를 지우지 않도록 합쳐서 넣는다(FormData 업로드도 그대로 동작한다)
      const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
      if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
      options = { ...init, headers };
    }

    const response = await originalFetch(input, options);

    // 토큰을 보냈는데도 거부당하면 로그인이 풀린 것이다.
    // 토큰 없이 받은 401(로그인 실패 등)은 여기서 다루지 않는다.
    if (response.status === 401 && token && !expiredHandled) {
      expiredHandled = true;
      onSessionExpired?.();
    }

    return response;
  };
};

export default installAuthFetch;

/**
 * 서버에서 파일을 받아 내려받기를 시작한다.
 *
 * <a href="...">로 바로 열면 브라우저가 새 요청을 보내는데, 그 요청에는 토큰이 실리지 않아
 * 로그인 검사에 걸린다. fetch로 받아서(토큰은 위에서 자동으로 붙는다) 파일로 저장한다.
 *
 * @param {string} url 받을 주소
 * @param {string} fallbackName 서버가 파일명을 안 알려줄 때 쓸 이름
 */
export const downloadFile = async (url, fallbackName = 'download') => {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(res.status === 403 ? '내려받을 권한이 없습니다.' : '파일을 받지 못했습니다.');
  }

  // 서버가 알려 준 파일명을 쓴다. 한글 파일명은 filename*=UTF-8'' 형태로 온다.
  const disposition = res.headers.get('content-disposition') || '';
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const plain = disposition.match(/filename="?([^";]+)"?/i);
  let name = fallbackName;
  if (encoded) {
    try { name = decodeURIComponent(encoded[1]); } catch { /* 이름만 못 읽는다 */ }
  } else if (plain) {
    name = plain[1];
  }

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
};
