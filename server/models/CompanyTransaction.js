import mongoose from 'mongoose';
import { COMPANY_ACCOUNTS } from '../../shared/companyAccounts.js';
const { Schema } = mongoose;

/**
 * 회사 장부 한 줄 (2026-10-05).
 *
 * 어느 차에도 속하지 않는 회사의 돈(월급, 임대료, 세무사비, 대출이자, 대표 차입금, 부가세 …)을 적는다.
 * 차 한 대의 돈은 차량 손익 원장(VehicleLedger)에 있다. 둘을 더하면 회사 전체가 된다.
 *
 * 지금은 자금팀 엑셀 "렌트베네핏 입출금 리스트"를 올려 채우고(source='excel'), 엑셀에 없는 줄은 화면에서 직접 적는다(source='manual').
 * 금액은 항상 양수로 두고, 들어왔는지 나갔는지는 direction으로 가른다. 재무제표의 어느 칸으로 갈지는 account가 정한다(shared/companyAccounts.js).
 */
const CompanyTransactionSchema = new Schema({
  date: { type: Date, required: true },
  direction: { type: String, enum: ['출금', '입금'], required: true },
  amount: { type: Number, required: true, min: 0 },
  account: { type: String, enum: COMPANY_ACCOUNTS.map((a) => a.key), required: true },
  description: { type: String, default: '' },
  memo: { type: String, default: '' },

  // 다른 줄과 겹쳐 합계에서 빼는 줄. 지우지 않고 남겨 두어야 엑셀을 다시 올려도 또 들어오지 않는다
  excluded: { type: Boolean, default: false },
  excludeReason: { type: String, default: '' },

  source: { type: String, enum: ['excel', 'manual'], default: 'manual' },
  // 엑셀 줄을 알아보는 열쇠. 엑셀을 다시 올리면 이 값으로 같은 줄을 찾는다
  importKey: { type: String },
  sourceSheet: String,
  sourceColumn: String,
  sourceRow: Number,
  // 사람이 화면에서 계정을 바꾼 줄. 엑셀을 다시 올려도 그 계정을 덮어쓰지 않는다
  accountEdited: { type: Boolean, default: false },

  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

CompanyTransactionSchema.index({ importKey: 1 }, { unique: true, partialFilterExpression: { importKey: { $type: 'string' } } });
CompanyTransactionSchema.index({ date: -1 });
CompanyTransactionSchema.index({ account: 1, date: -1 });

export default mongoose.model('CompanyTransaction', CompanyTransactionSchema);
