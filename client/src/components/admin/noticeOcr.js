// 범칙금·과태료·미납통행료 고지서 자동 인식에 쓰는 것들.
// 청구서 화면(MonthlyBillingView)과 고지서 관리의 여러 장 올리기(BulkNoticeUpload)가 함께 쓴다.

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

// 글자를 읽는 종류. 정비내역·기타는 서식이 제각각이라 읽지 않는다.
export const NOTICE_KINDS = ['범칙금', '과태료', '통행료'];

/** 읽을 수 있는 파일인지. CLOVA OCR이 받는 형식만 보낸다. */
export const isReadableFile = (file) => /^image\/(jpeg|jpg|png|tiff)$|^application\/pdf$/.test(file?.type || '');

/**
 * 서버가 가른 고지서의 갈 곳. 여러 장 올리기 표의 색과 청구서 화면의 경고에 쓴다.
 * ready가 true인 것만 [확정 건 한꺼번에 등록]에 들어간다.
 */
export const ROUTE_INFO = {
  longterm: { label: '장기렌트', color: '#16a34a', bg: '#f0fdf4', ready: true },
  rental: { label: '대차', color: '#0284c7', bg: '#f0f9ff', ready: true },
  review: { label: '확인 필요', color: '#d97706', bg: '#fffbeb', ready: false },
  notOurs: { label: '우리 차 아님', color: '#64748b', bg: '#f8fafc', ready: false },
  unread: { label: '번호 못 읽음', color: '#dc2626', bg: '#fef2f2', ready: false },
  error: { label: '읽기 실패', color: '#dc2626', bg: '#fef2f2', ready: false }
};

/**
 * 고지서 파일을 서버로 보내 글자를 읽는다. 저장하지 않는다.
 *
 * @param {File} file 고지서 파일
 * @returns {Promise<object>} 서버 응답. 실패하면 { success: false, message }
 */
export const readNotice = async (file) => {
  const fd = new FormData();
  fd.append('file', file);
  try {
    const res = await fetch(`${API_HOST}/api/ocr/fine-notice`, { method: 'POST', body: fd });
    const data = await res.json();
    return data.success ? data : { success: false, message: data.message || '글자를 읽지 못했습니다.' };
  } catch {
    return { success: false, message: '서버 통신 오류로 글자를 읽지 못했습니다.' };
  }
};
