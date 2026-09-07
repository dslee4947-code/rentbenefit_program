import fs from 'fs';
import path from 'path';
import { getGraphAccessToken } from './graphAuth.js';
import { getOrCreateTemplate } from '../controllers/mailTemplateController.js';

/**
 * 청구서 메일.
 *
 * 제목·본문·서명은 화면(청구서 > 메일 양식)에서 고친 값을 쓴다.
 * 서명은 회사에서 쓰던 그림을 그대로 붙인다. 글자로 다시 짜면 줄 간격이나 로고가 어긋난다.
 * 그림은 첨부로 보내고 본문에서 cid로 부른다. 외부 링크로 걸면 수신함에서 막히는 일이 잦다.
 */
const SIGNATURE_CONTENT_ID = 'rentbenefit-signature';
const LOGO_CONTENT_ID = 'rentbenefit-logo';

/** HTML에 그대로 넣으면 안 되는 문자를 바꾼다. 본문은 사람이 적는 글이라 <, & 가 들어올 수 있다. */
const escapeHtml = (text) => String(text ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

/**
 * 치환 항목을 실제 값으로 바꾼다. {{계약자}} 처럼 쓴다.
 *
 * @param {string} text 원문
 * @param {object} values 치환할 값들
 * @returns {string} 바뀐 글
 */
export const applyPlaceholders = (text, values = {}) => {
  return String(text ?? '').replace(/\{\{\s*([^}]+?)\s*\}\}/g, (whole, name) => {
    const v = values[name];
    return v === undefined || v === null ? whole : String(v);
  });
};

/** 메일에 붙일 로고를 읽는다. 없으면 로고 없이 보낸다(발송 자체를 막지 않는다). */
const readLogo = () => {
  const candidates = [
    path.resolve(process.cwd(), '../client/public/logo.png'),
    path.resolve(process.cwd(), 'client/public/logo.png'),
    path.resolve(process.cwd(), '../client/dist/logo.png')
  ];
  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) return fs.readFileSync(file);
    } catch { /* 다음 후보로 */ }
  }
  return null;
};

/**
 * 본문 HTML을 만든다. 사람이 적은 줄바꿈을 그대로 살린다.
 *
 * @param {string} body 본문 (여러 줄)
 * @param {'signature'|'logo'|null} tail 아래에 붙일 그림
 * @returns {string} HTML
 */
const buildHtmlBody = (body, tail) => {
  const paragraphs = String(body || '')
    .split(/\n{2,}/)
    .map((block) => `<p style="margin:0 0 12px">${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('');

  let image = '';
  if (tail === 'signature') {
    image = `<div style="margin-top:24px"><img src="cid:${SIGNATURE_CONTENT_ID}" alt="" style="max-width:100%"></div>`;
  } else if (tail === 'logo') {
    image = `<p style="margin-top:24px"><img src="cid:${LOGO_CONTENT_ID}" alt="RENT BENefit" style="height:40px"></p>`;
  }

  return `
  <div style="font-family:'Malgun Gothic',sans-serif;font-size:14px;color:#222;line-height:1.7">
    ${paragraphs}
    ${image}
  </div>
`;
};

/**
 * 청구서를 메일로 보낸다.
 *
 * Microsoft Graph의 앱 전용 토큰을 쓴다(아웃룩 동기화와 같은 Azure 앱).
 * 보내려면 그 앱에 Mail.Send 응용 프로그램 권한과 관리자 동의가 있어야 한다.
 * 없으면 Graph가 403을 주는데, 무엇이 부족한지 알 수 있게 그대로 알려 준다.
 *
 * @param {object} params
 * @param {string} params.to 받는 사람
 * @param {string} [params.subject] 제목. 주지 않으면 저장된 양식을 쓴다
 * @param {string} params.fileName 청구서 파일명
 * @param {Buffer} params.fileBuffer 청구서 파일
 * @param {Array<{fileName: string, buffer: Buffer}>} [params.extraFiles] 함께 보낼 서류(범칙금 고지서 등)
 * @param {object} [params.values] 제목·본문의 치환 값 ({{계약자}} 등)
 * @param {string} [params.cc] 참조
 */
export const sendInvoiceMail = async ({ to, subject, fileName, fileBuffer, extraFiles = [], values = {}, cc }) => {
  return sendTemplateMail({
    to,
    cc,
    subject,
    values,
    files: [{ fileName, buffer: fileBuffer, contentType: 'application/pdf' }, ...extraFiles],
    missingToMessage: '받는 사람 이메일이 없습니다. 법인 관리에서 청구 이메일을 먼저 등록해 주세요.'
  });
};

/**
 * 고지서 안내 메일.
 *
 * 고지서가 오면 먼저 고객에게 알린다. 기한 안에 직접 내면 청구하지 않고,
 * 안 내면 다음 달 렌트료에 얹어 청구한다. 그 순서가 실제 업무다.
 * 받는 곳은 계약에 적어 둔 범칙금 전용 메일(finesEmail)이다.
 *
 * @param {object} params
 * @param {string} params.to 받는 사람 (계약의 범칙금 메일)
 * @param {string} [params.cc] 참조 (범칙금 메일 2)
 * @param {string} params.fileName 고지서 파일명
 * @param {Buffer} params.fileBuffer 고지서 파일
 * @param {object} params.values 치환 값 ({{계약자}} {{차량번호}} {{종류}} {{위반일}} {{금액}} {{납부기한}})
 * @param {string} [params.templateKey] 처리 방식에 맞는 양식
 *   ('fine-notice' 대납 · 'fine-notice-driver' 고객납부 · 'fine-notice-transfer' 명의변경)
 * @param {Array<{fileName: string, buffer: Buffer}>} [params.extraFiles] 함께 붙일 서류(명의변경은 계약서)
 */
export const sendFineNoticeMail = async ({ to, cc, fileName, fileBuffer, values = {}, templateKey = 'fine-notice', extraFiles = [] }) => {
  return sendTemplateMail({
    to,
    cc,
    values,
    templateKey,
    files: [...(fileBuffer ? [{ fileName, buffer: fileBuffer }] : []), ...extraFiles],
    missingToMessage: '받는 사람 이메일이 없습니다. 계약서의 범칙금 E-MAIL을 먼저 등록해 주세요.'
  });
};

/**
 * 저장된 양식으로 메일을 보낸다. 청구서와 고지서 안내가 같은 길을 쓴다.
 *
 * Microsoft Graph의 앱 전용 토큰을 쓴다(아웃룩 동기화와 같은 Azure 앱).
 * 보내려면 그 앱에 Mail.Send 응용 프로그램 권한과 관리자 동의가 있어야 한다.
 *
 * @param {object} params
 * @param {string} params.to 받는 사람
 * @param {string} [params.cc] 참조
 * @param {string} [params.subject] 제목. 주지 않으면 저장된 양식을 쓴다
 * @param {object} [params.values] 치환 값
 * @param {string} [params.templateKey] 양식 종류
 * @param {Array<{fileName: string, buffer: Buffer, contentType?: string}>} [params.files] 붙일 파일
 * @param {string} [params.missingToMessage] 받는 사람이 없을 때 알릴 말
 */
const sendTemplateMail = async ({ to, cc, subject, values = {}, templateKey = 'invoice', files = [], missingToMessage }) => {
  if (!to) throw new Error(missingToMessage || '받는 사람 이메일이 없습니다.');

  const sender = process.env.INVOICE_SENDER_EMAIL || process.env.OUTLOOK_TARGET_EMAIL;
  if (!sender) {
    throw new Error('보내는 메일 주소가 설정되지 않았습니다. INVOICE_SENDER_EMAIL 또는 OUTLOOK_TARGET_EMAIL을 설정해 주세요.');
  }

  const template = await getOrCreateTemplate(templateKey);
  const finalSubject = applyPlaceholders(subject || template.subject, values);
  const finalBody = applyPlaceholders(template.body, values);

  const token = await getGraphAccessToken();

  const attachments = files.map((f) => ({
    '@odata.type': '#microsoft.graph.fileAttachment',
    name: f.fileName,
    ...(f.contentType ? { contentType: f.contentType } : {}),
    contentBytes: f.buffer.toString('base64')
  }));

  // 서명은 종류가 달라도 같은 회사 서명이다. 청구서 양식에 올려 둔 것을 함께 쓴다.
  const signatureSource = templateKey === 'invoice' ? template : await getOrCreateTemplate('invoice');

  // 서명 이미지를 올려 두었으면 그것만 붙인다(그 안에 이미 로고가 들어 있다).
  // 없을 때만 예전처럼 로고를 붙인다.
  let tail = null;
  const signature = signatureSource.signature;
  if (signature?.data?.length) {
    attachments.push({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: signature.fileName || 'signature.png',
      contentType: signature.contentType || 'image/png',
      contentBytes: Buffer.from(signature.data).toString('base64'),
      isInline: true,
      contentId: SIGNATURE_CONTENT_ID
    });
    tail = 'signature';
  } else {
    const logo = readLogo();
    if (logo) {
      attachments.push({
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: 'logo.png',
        contentType: 'image/png',
        contentBytes: logo.toString('base64'),
        isInline: true,
        contentId: LOGO_CONTENT_ID
      });
      tail = 'logo';
    }
  }

  const message = {
    message: {
      subject: finalSubject,
      body: { contentType: 'HTML', content: buildHtmlBody(finalBody, tail) },
      toRecipients: [{ emailAddress: { address: to } }],
      ...(cc ? { ccRecipients: [{ emailAddress: { address: cc } }] } : {}),
      attachments
    },
    saveToSentItems: true
  };

  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(message)
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    if (res.status === 403) {
      throw new Error('메일 발송 권한이 없습니다. Azure 앱에 Mail.Send 응용 프로그램 권한과 관리자 동의가 필요합니다.');
    }
    throw new Error(`메일 발송에 실패했습니다. (Graph ${res.status}) ${detail.slice(0, 300)}`);
  }

  return { sender, to, subject: finalSubject };
};
