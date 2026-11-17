/**
 * 사업용자동차 차령조정 신청서 (여객자동차 운수사업법 시행규칙 별지 제55호서식).
 * 렌터카 차령이 끝나기 전에 검사를 받고 서울시에 차령 연장을 신청할 때 낸다.
 * 2026-10-21에 낸 45대 신청서(Dropbox 15. 자동차 검사/차령 연장)의 칸 값을 기본값으로 쓴다.
 */

export const CAR_AGE_STATUSES = ['작성중', '제출', '처리완료', '취소'];

export const DEFAULT_CAR_AGE_APPLICANT = {
  name: '주식회사 렌트베네핏',
  ceo: '대표자 신동일',
  corpNo: '110111-8045472',
  address: '서울특별시 서초구 양재대로11길 36, 은관505호',
  address2: '(양재동, 서울오토갤러리)',
  phone: '',
  business: '자동차대여사업 (업태: 서비스 / 종목: 렌트카)',
  signName: '㈜렌트베네핏 신동일',
  addressee: '서울특별시장'
};

/** ⑤칸 글: 차가 많으면 별첨으로 돌린다. 한 대면 번호를 바로 적는다. */
export const targetTextOf = (items = []) => {
  const n = items.length;
  if (!n) return { main: '', sub: '' };
  if (n === 1) {
    const it = items[0];
    return { main: `${it.plateNo}${it.carName ? ` (${it.carName})` : ''}`, sub: '(사업용자동차 정기·임시검사 합격통지서 1부 첨부)' };
  }
  return { main: `별첨 목록 기재 차량 ${n}대`, sub: `(사업용자동차 정기·임시검사 합격통지서 ${n}부 첨부)` };
};
