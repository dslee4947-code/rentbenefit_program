import dotenv from 'dotenv';
import mongoose from 'mongoose';
import ContractTemplate from '../models/ContractTemplate.js';
import ContractTemplateFile from '../models/ContractTemplateFile.js';
import { parseContractTemplate } from '../utils/contractTemplateParser.js';

dotenv.config();

/**
 * 올려 둔 전자계약서 양식을 보관된 엑셀 원본으로 다시 해석한다.
 * 해석기(utils/contractTemplateParser.js)를 고친 뒤 이미 올린 양식에도 반영할 때 쓴다.
 * 원본 파일은 그대로라 sha256·버전·사용 중 여부는 바뀌지 않는다. 원문 글자 수가 달라지면 알려 준다.
 *
 *   node scripts/reparse-contract-templates.js            보기만
 *   node scripts/reparse-contract-templates.js --apply    저장
 */
const apply = process.argv.includes('--apply');

const run = async () => {
  await mongoose.connect(process.env.MONGODB_ATLAS_URL || process.env.MONGO_URI);
  for (const t of await ContractTemplate.find({}).select('name version fileName stats sha256')) {
    const file = await ContractTemplateFile.findOne({ template: t._id }).lean();
    if (!file) { console.log(`v${t.version} 원본 파일 없음 — 건너뜀`); continue; }
    const parsed = parseContractTemplate(Buffer.from(file.data.buffer || file.data), t.fileName);
    if (parsed.sha256 !== t.sha256) { console.log(`v${t.version} 원본 확인값이 다름 — 건너뜀`); continue; }
    const before = t.stats?.textChars;
    console.log(`v${t.version} ${t.name}: 원문 ${before} → ${parsed.stats.textChars}자, 조항 ${t.stats?.clauses} → ${parsed.stats.clauses}개`);
    if (apply) {
      await ContractTemplate.updateOne({ _id: t._id }, {
        $set: { sheets: parsed.sheets, styles: parsed.styles, fields: parsed.fields, pages: parsed.pages, clauses: parsed.clauses, media: parsed.media, stats: parsed.stats }
      });
    }
  }
  console.log(apply ? '저장했습니다.' : '보기만 했습니다. 저장하려면 --apply');
  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
