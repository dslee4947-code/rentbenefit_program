import crypto from 'crypto';

/**
 * 구글 업무캘린더 연결 (서버 전용 서비스 계정).
 *
 * 직원들은 핸드폰 구글 캘린더로 정비 일정을 보고 적는다(대표님 2026-10-28, 캘린더는 포기할 수 없음).
 * 그래서 프로그램이 업무캘린더를 읽고(정비 기록으로 옮기기) 쓴다(정비 접수·다음 점검 일정 올리기).
 *
 * 업무캘린더는 서비스 계정에 '변경 후 모든 일정 세부정보 확인' 권한으로 공유되어 있다.
 * 열쇠(JSON)는 서버 비밀 설정 GOOGLE_SERVICE_ACCOUNT_KEY에 base64로 둔다. 저장소에 넣지 않는다.
 * googleapis 패키지는 크고 여기서 쓰는 건 일정 목록·만들기·고치기뿐이라, 인증(JWT)도 직접 한다.
 */

export const WORK_CALENDAR_ID = process.env.GOOGLE_WORK_CALENDAR_ID || 'qfnolr5pr70ojgsdmn720ff1dk@group.calendar.google.com';
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const API = 'https://www.googleapis.com/calendar/v3';

let key = null;
const loadKey = () => {
  if (key) return key;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) return null;
  const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  key = JSON.parse(text);
  return key;
};

/** 열쇠가 설정되어 있는지. 없으면 캘린더 연동은 아무것도 하지 않는다(시험 서버 등). */
export const isGoogleCalendarConfigured = () => Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);

let token = null;
let tokenExp = 0;
const accessToken = async () => {
  if (token && Date.now() < tokenExp - 60 * 1000) return token;
  const k = loadKey();
  if (!k) throw new Error('구글 캘린더 열쇠(GOOGLE_SERVICE_ACCOUNT_KEY)가 설정되지 않았습니다.');
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: k.client_email, scope: SCOPE, aud: k.token_uri, iat: now, exp: now + 3600 })}`;
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(k.private_key).toString('base64url');
  const res = await fetch(k.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` })
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`구글 인증 실패: ${data.error_description || data.error || res.status}`);
  token = data.access_token;
  tokenExp = Date.now() + (data.expires_in || 3600) * 1000;
  return token;
};

const call = async (method, path, { query, body } = {}) => {
  const url = `${API}${path}${query ? `?${new URLSearchParams(query)}` : ''}`;
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`구글 캘린더 ${method} ${res.status}: ${data.error?.message || ''}`);
  return data;
};

const eventsPath = (calendarId) => `/calendars/${encodeURIComponent(calendarId)}/events`;

/**
 * 지정한 때 이후 바뀐(새로 생긴·고친·지운) 일정 전부.
 * 반복 일정은 하루하루로 풀어서 받는다. 지운 일정은 status 'cancelled'로 온다.
 *
 * @param {Date} updatedMin
 * @param {string} [calendarId]
 * @returns {Promise<object[]>}
 */
export const listChangedEvents = async (updatedMin, calendarId = WORK_CALENDAR_ID) => {
  const items = [];
  let pageToken;
  do {
    // eslint-disable-next-line no-await-in-loop
    const data = await call('GET', eventsPath(calendarId), {
      query: {
        updatedMin: updatedMin.toISOString(),
        showDeleted: 'true',
        singleEvents: 'true',
        maxResults: '250',
        ...(pageToken ? { pageToken } : {})
      }
    });
    items.push(...(data.items || []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return items;
};

export const insertEvent = (event, calendarId = WORK_CALENDAR_ID) => call('POST', eventsPath(calendarId), { body: event });
export const patchEvent = (eventId, patch, calendarId = WORK_CALENDAR_ID) => call('PATCH', `${eventsPath(calendarId)}/${encodeURIComponent(eventId)}`, { body: patch });
export const deleteEvent = (eventId, calendarId = WORK_CALENDAR_ID) => call('DELETE', `${eventsPath(calendarId)}/${encodeURIComponent(eventId)}`);
