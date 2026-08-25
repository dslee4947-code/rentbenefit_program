import { randomUUID } from 'crypto';
import { PDFParse } from 'pdf-parse';

// 환경변수는 반드시 호출 시점에 읽는다.
// index.js는 dotenv.config()가 import 구문들보다 뒤에 있어서,
// 모듈 최상단에서 process.env를 읽으면 항상 undefined가 된다.
const getClovaConfig = () => ({
  invokeUrl: process.env.CLOVA_OCR_INVOKE_URL,
  secret: process.env.CLOVA_OCR_SECRET
});

const EMPTY_RESULT = {
  bizNo: '',
  name: '',
  ceoName: '',
  address: '',
  bizType: ''
};

const CLOVA_FORMAT_BY_MIME = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/tiff': 'tiff'
};

/**
 * Extracts business registration certificate details from PDF or image files.
 *
 * PDF는 내장 텍스트 추출을 먼저 시도하고(무료·즉시), 텍스트가 없는 스캔본이거나
 * 이미지 파일이면 CLOVA OCR로 넘긴다. 추출에 실패하면 빈 값을 돌려주고
 * 사용자가 직접 입력하도록 한다 - 추측한 값을 채워 넣지 않는다.
 *
 * @param {Buffer} fileBuffer The uploaded file buffer
 * @param {string} mimeType The file mime type
 * @param {string} originalName The original filename
 * @returns {Promise<{bizNo: string, name: string, ceoName: string, address: string, bizType: string, source: string}>}
 */
export const parseBusinessRegistration = async (fileBuffer, mimeType, originalName) => {
  if (mimeType === 'application/pdf') {
    const text = await extractPdfText(fileBuffer);

    if (text.trim().length > 30) {
      const parsed = extractFieldsFromText(text);
      if (parsed.name || parsed.bizNo) {
        return { ...parsed, source: 'pdf-text' };
      }
      console.log('[OCR Service] PDF 텍스트에서 사업자 정보를 찾지 못했습니다. CLOVA OCR로 재시도합니다.');
    } else {
      console.log(`[OCR Service] 텍스트가 없는 PDF입니다(${text.trim().length}자). 스캔본으로 보고 CLOVA OCR로 처리합니다.`);
    }
  }

  const { invokeUrl, secret } = getClovaConfig();
  if (!invokeUrl || !secret) {
    throw new Error(
      'OCR 엔진이 설정되지 않아 이미지에서 정보를 읽을 수 없습니다. ' +
      '관리자에게 CLOVA_OCR_INVOKE_URL / CLOVA_OCR_SECRET 설정을 요청하거나, 정보를 직접 입력해 주세요.'
    );
  }

  const format = CLOVA_FORMAT_BY_MIME[mimeType];
  if (!format) {
    throw new Error(`지원하지 않는 파일 형식입니다(${mimeType}). JPG, PNG, TIFF, PDF만 업로드할 수 있습니다.`);
  }

  const clovaResult = await requestClovaOcr({ fileBuffer, format, originalName, invokeUrl, secret });
  return { ...clovaResult, source: 'clova' };
};

/**
 * Reads the embedded text layer of a PDF. Returns an empty string for scanned PDFs.
 */
const extractPdfText = async (fileBuffer) => {
  const parser = new PDFParse({ data: fileBuffer });
  try {
    const data = await parser.getText();
    const text = data.text || '';
    console.log(`[OCR Service] PDF 텍스트 추출: ${text.length}자`);
    return text;
  } catch (err) {
    console.error('[OCR Service] PDF 텍스트 추출 실패:', err.message);
    return '';
  } finally {
    await parser.destroy();
  }
};

/**
 * Calls CLOVA OCR and normalizes the response.
 *
 * 사업자등록증 전용 도메인이면 구조화된 필드(bizLicense)가 오고,
 * 일반(General) 도메인이면 인식된 텍스트 조각만 온다. 두 경우 모두 처리한다.
 */
const requestClovaOcr = async ({ fileBuffer, format, originalName, invokeUrl, secret }) => {
  const body = {
    version: 'V2',
    requestId: randomUUID(),
    timestamp: Date.now(),
    images: [
      {
        format,
        name: originalName || 'business-registration',
        data: fileBuffer.toString('base64')
      }
    ]
  };

  let res;
  try {
    res = await fetch(invokeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-OCR-SECRET': secret
      },
      body: JSON.stringify(body)
    });
  } catch (err) {
    console.error('[OCR Service] CLOVA 호출 실패:', err);
    throw new Error('OCR 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error(`[OCR Service] CLOVA 응답 오류 ${res.status}: ${detail.slice(0, 500)}`);
    throw new Error(`OCR 분석에 실패했습니다. (CLOVA 응답 코드 ${res.status})`);
  }

  const payload = await res.json();
  const image = payload?.images?.[0];

  if (!image || image.inferResult === 'ERROR') {
    console.error('[OCR Service] CLOVA 인식 실패:', JSON.stringify(image?.message || payload).slice(0, 500));
    throw new Error('사업자등록증을 인식하지 못했습니다. 더 선명한 이미지로 다시 시도해 주세요.');
  }

  if (image.bizLicense?.result) {
    return mapBizLicenseResult(image.bizLicense.result);
  }

  const text = (image.fields || []).map((f) => f.inferText || '').join(' ');
  console.log(`[OCR Service] CLOVA 일반 도메인 응답: ${text.length}자`);
  return extractFieldsFromText(text);
};

/**
 * Maps CLOVA's 사업자등록증 template output onto our company fields.
 *
 * CLOVA는 필드 키 이름이 도메인 설정에 따라 조금씩 다르게 오므로 후보 키를 순서대로 확인한다.
 * 주의: CLOVA의 bizType은 업태(예: 서비스업)라서 우리 쪽 구분(법인/개인사업자)과 다른 값이다.
 */
const mapBizLicenseResult = (result) => {
  const pick = (...keys) => {
    for (const key of keys) {
      const value = result[key];
      const text = Array.isArray(value) ? value[0]?.text : value?.text;
      if (text && text.trim()) return text.trim();
    }
    return '';
  };

  const bizNo = normalizeBizNo(pick('registerNumber', 'bizNumber', 'registrationNumber'));
  const corpName = pick('corpName');
  const name = pick('companyName', 'bizName', 'corpName');

  return {
    bizNo,
    name,
    ceoName: pick('repName', 'representativeName'),
    address: pick('bizAddress', 'bisAddress', 'address', 'corpAddress'),
    bizType: classifyBizType({ bizNo, hasCorpName: Boolean(corpName) })
  };
};

/**
 * Parses structured text using regex to extract business registration certificate fields.
 */
const extractFieldsFromText = (text) => {
  const result = { ...EMPTY_RESULT };

  // 1. 사업자등록번호 - 000-00-00000 형식
  const bizNoMatch = text.match(/(\d{3}-\d{2}-\d{5})/);
  if (bizNoMatch) {
    result.bizNo = bizNoMatch[1];
  }

  // 2. 상호 (법인명)
  const nameMatch = text.match(/(?:상호|법인명|상호\s*\(법인명\))\s*[:\s]+([^\n\r]+)/i);
  if (nameMatch) {
    result.name = nameMatch[1]
      .replace(/[\(]주[\)]/g, '(주)')
      .replace(/[:]/g, '')
      .trim();
  }

  // 3. 대표자 성명
  const ceoMatch = text.match(/(?:대표자|성명|대표자\s*성명)\s*[:\s]+([^\n\r]+)/i);
  if (ceoMatch) {
    result.ceoName = ceoMatch[1].replace(/[:]/g, '').trim();
  }

  // 4. 사업장 소재지
  const addressMatch = text.match(/(?:소재지|사업장소재지|사업장\s*소재지|주소)\s*[:\s]+([^\n\r]+)/i);
  if (addressMatch) {
    result.address = addressMatch[1].replace(/[:]/g, '').trim();
  }

  // 5. 구분 - 문서에 명시된 표기를 우선하고, 없으면 사업자번호로 판별
  if (text.includes('법인사업자')) {
    result.bizType = '법인사업자';
  } else if (text.includes('개인사업자')) {
    result.bizType = '개인사업자';
  } else {
    result.bizType = classifyBizType({ bizNo: result.bizNo, hasCorpName: false });
  }

  return result;
};

/**
 * Normalizes a business registration number to 000-00-00000.
 */
const normalizeBizNo = (raw) => {
  const digits = (raw || '').replace(/\D/g, '');
  if (digits.length !== 10) return raw || '';
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
};

/**
 * Determines 법인사업자 / 개인사업자.
 *
 * 사업자등록번호 가운데 두 자리가 81~88이면 법인이다.
 * 판별할 근거가 없으면 빈 값을 반환해 사용자가 직접 고르게 한다.
 */
const classifyBizType = ({ bizNo, hasCorpName }) => {
  const digits = (bizNo || '').replace(/\D/g, '');
  if (digits.length === 10) {
    const middle = Number(digits.slice(3, 5));
    return middle >= 81 && middle <= 88 ? '법인사업자' : '개인사업자';
  }
  return hasCorpName ? '법인사업자' : '';
};