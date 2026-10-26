import Contract from '../models/Contract.js';
import Company from '../models/Company.js';
import Customer from '../models/Customer.js';
import Vehicle from '../models/Vehicle.js';
import { saveDocument, readSavedFile, buildContractFolderName } from '../utils/documentStorageService.js';
import { logActivity, ACTIONS } from '../utils/activityLog.js';

/**
 * 서명 완료본(모두싸인 등에서 서명을 마친 계약서 PDF) 올리기·내려받기.
 *
 * 신차·중고·연장 계약 모두 같은 방식이다(대표님 2026-10-26). 파일은 계약자 폴더 01.계약서/{계약 폴더}에
 * '{계약번호}_계약서_서명완료_v{n}.pdf'로 넣고, 계약에는 기록(signedDocuments)만 둔다.
 * 다시 올리면 새 버전이 붙고 예전 파일은 지우지 않는다(서명을 다시 받은 경우에도 예전 것을 확인할 수 있게).
 */

const partyNameOf = async (contract) => contract.customerFolder
  || (contract.companyId ? (await Company.findById(contract.companyId).select('name').lean())?.name : '')
  || (contract.customer ? (await Customer.findById(contract.customer).select('name').lean())?.name : '')
  || '';

const userNameOf = (req) => req.user?.name || req.user?.email || '';

/**
 * 서명 완료본을 올린다. PDF만 받는다.
 * @route POST /api/contracts/:id/signed   (multipart: file, note)
 */
export const uploadSignedDocument = async (req, res) => {
  try {
    const contract = await Contract.findById(req.params.id);
    if (!contract) return res.status(404).json({ success: false, message: '계약을 찾을 수 없습니다.' });
    if (!req.file) return res.status(400).json({ success: false, message: '서명 완료본 PDF 파일을 골라 주세요.' });
    const isPdf = /\.pdf$/i.test(req.file.originalname || '') || req.file.mimetype === 'application/pdf';
    if (!isPdf) return res.status(400).json({ success: false, message: 'PDF 파일만 올릴 수 있습니다.' });

    const saved = await saveSignedFile(contract, req.file.buffer, { note: req.body?.note, by: userNameOf(req) });
    logActivity({
      req, dept: '계약·출고부', action: ACTIONS.CONTRACT_SIGNED,
      target: { model: 'Contract', id: contract._id },
      summary: `${contract.contractNo} 서명 완료본 올림 (v${saved.version})`,
      meta: { contractNo: contract.contractNo, version: saved.version, fileName: saved.fileName }
    });
    res.status(201).json({
      success: true,
      signedDocuments: contract.signedDocuments,
      signedAt: contract.signedAt,
      message: `서명 완료본을 계약 폴더에 저장했습니다 (v${saved.version} · ${saved.fileName}).`
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 계약에 서명 완료본을 저장하고 기록을 붙인다(저장까지 한다). 연장할 때도 이 함수를 쓴다.
 * @param {import('mongoose').Document} contract
 * @param {Buffer} buffer PDF
 * @param {{note?: string, by?: string}} [options]
 * @returns {Promise<object>} 붙인 기록 한 줄
 */
export const saveSignedFile = async (contract, buffer, { note, by } = {}) => {
  const partyName = await partyNameOf(contract);
  if (!partyName) throw new Error('계약자 이름을 몰라 저장할 폴더를 정하지 못했습니다. 계약에 법인·고객을 먼저 연결해 주세요.');
  let subFolder = contract.docFolderName;
  if (!subFolder) {
    const vehicles = await Vehicle.find({ contract: contract._id }).select('carModel').lean();
    subFolder = await buildContractFolderName(contract.contractNo, vehicles);
    contract.docFolderName = subFolder;
    contract.customerFolder = contract.customerFolder || partyName;
  }
  const version = (contract.signedDocuments || []).reduce((m, d) => Math.max(m, d.version || 0), 0) + 1;
  const stored = await saveDocument({
    partyName,
    kind: 'contract',
    subFolder,
    fileName: `${contract.contractNo}_계약서_서명완료_v${version}.pdf`,
    fileBuffer: buffer,
    keepPrevious: true
  });
  const row = {
    version,
    fileName: stored.fileName,
    savedPath: stored.localPath,
    webUrl: stored.webUrl,
    size: buffer.length,
    uploadedAt: new Date(),
    uploadedBy: by || '',
    note: String(note || '').trim()
  };
  contract.signedDocuments.push(row);
  contract.signedAt = row.uploadedAt;
  await contract.save();
  return row;
};

/**
 * 서명 완료본 목록.
 * @route GET /api/contracts/:id/signed
 */
export const getSignedDocuments = async (req, res) => {
  try {
    const contract = await Contract.findById(req.params.id).select('contractNo contractKind signedDocuments signedAt signedOverride').lean();
    if (!contract) return res.status(404).json({ success: false, message: '계약을 찾을 수 없습니다.' });
    res.json({ success: true, ...contract, signedDocuments: contract.signedDocuments || [] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 서명 완료본 한 버전을 내려받는다(화면에서 열어 보기).
 * @route GET /api/contracts/:id/signed/:version/file
 */
export const downloadSignedDocument = async (req, res) => {
  try {
    const contract = await Contract.findById(req.params.id).select('signedDocuments').lean();
    const doc = (contract?.signedDocuments || []).find((d) => d.version === Number(req.params.version));
    if (!doc) return res.status(404).json({ success: false, message: '해당 버전의 서명 완료본이 없습니다.' });
    const buffer = await readSavedFile(doc.savedPath);
    if (!buffer) return res.status(404).json({ success: false, message: '저장된 파일을 읽지 못했습니다. 폴더에서 옮겨졌는지 확인해 주세요.' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`);
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
