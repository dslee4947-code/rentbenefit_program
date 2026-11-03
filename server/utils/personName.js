/**
 * 사람 이름에서 직함을 떼어낸다.
 *
 * 운영 엑셀의 담당자 칸은 "유영석 사장님", "장혜원 대표님"처럼 직함을 붙여 적는다.
 * 대표자 칸은 이름만 들어가는 자리이고(이미 들어와 있는 값도 "장혜원"처럼 이름뿐이다),
 * 직함이 섞이면 같은 사람이 "장혜원"과 "장혜원 대표님" 두 갈래로 남는다.
 *
 * 담당자 칸(계약의 책임담당자)에는 적힌 그대로 남기고, 대표자로 넣을 때만 이 함수를 쓴다.
 * 계약서·계약사실 증명원에 찍을 때도 사람 이름(개인 계약자·대표자·계약담당자)은 이 함수로 이름만 남긴다(대표님 2026-11-03).
 * 법인명에는 쓰지 않는다('OO제약사'처럼 끝 글자가 직함과 겹칠 수 있다).
 */

// 끝에 붙는 직함. 긴 것부터 맞춰 봐야 '부사장님'에서 '사장'만 떼고 "이우선 부"가 남는 일이 없다.
const TITLES = [
  '대표이사', '부회장', '부사장', '위원장', '본부장', '이사장',
  '대표', '회장', '사장', '전무', '상무', '이사',
  '부장', '차장', '과장', '대리', '팀장', '실장', '소장', '원장', '점장', '주임', '사원',
  '교수', '박사', '변호사', '세무사', '회계사', '약사',
  '담당자', '담당', '고객', '기사', '선생', '씨'
];

/**
 * @param {string} raw "유영석 사장님", "김의성 위원장님"
 * @returns {string} "유영석", "김의성"
 *   직함을 떼면 두 글자도 안 남는 경우(이름 자체가 직함과 겹치는 '이사장' 등)엔 원문 그대로 둔다.
 */
export const stripHonorific = (raw) => {
  const original = String(raw ?? '').trim();
  if (!original) return '';

  let text = original;
  let stripped = true;
  while (stripped) {
    stripped = false;

    if (text.endsWith('님')) {
      text = text.slice(0, -1).trim();
      stripped = true;
    }

    for (const title of TITLES) {
      // 떼고 나서 이름이 두 글자는 남아야 한다. '김대표'의 '대표'를 떼면 '김'만 남는다.
      if (text.endsWith(title) && text.length - title.length >= 2) {
        text = text.slice(0, -title.length).trim();
        stripped = true;
        break;
      }
    }
  }

  return text.length >= 2 ? text : original;
};

/**
 * 개인 고객의 주민등록번호는 앞 6자리(생년월일)만 쓰고 뒷자리는 가린다. 프로그램은 뒷자리를 받지도 두지도 않는다.
 * @param {string} value 앞 6자리, 또는 6-7자리 번호
 * @returns {string} '760101-*******', 숫자 6자리로 시작하지 않으면 ''
 */
export const maskResidentNo = (value) => {
  const m = /^\s*(\d{6})(?:\s*-?\s*[\d*]{1,7})?\s*$/.exec(String(value ?? ''));
  return m ? `${m[1]}-*******` : '';
};
