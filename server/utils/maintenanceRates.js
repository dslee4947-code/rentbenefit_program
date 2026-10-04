import Setting from '../models/Setting.js';
import { mergeMaintenanceRates } from '../../shared/maintenanceRates.js';

/**
 * 차종 등급별 정비 단가표를 읽는다.
 *
 * 관리자가 '정비 단가표' 화면에서 저장한 값이 있으면 그 값을, 없는 등급·항목은 shared의 기본값을 쓴다.
 * 렌트차량 DB 이익을 계산할 때마다 DB를 읽지 않도록 1분 동안 기억해 둔다.
 */
export const MAINTENANCE_RATES_KEY = 'maintenanceRates';

let cached = null;
let cachedAt = 0;
const TTL_MS = 60 * 1000;

export const getMaintenanceRates = async () => {
  if (cached && Date.now() - cachedAt < TTL_MS) return cached;
  try {
    const doc = await Setting.findOne({ key: MAINTENANCE_RATES_KEY }).lean();
    cached = mergeMaintenanceRates(doc?.value);
    cachedAt = Date.now();
    return cached;
  } catch (err) {
    // 단가표를 못 읽어도 이익 계산은 기본값으로 계속한다
    console.error('[정비 단가표] 읽지 못해 기본값을 씁니다:', err.message);
    return mergeMaintenanceRates(null);
  }
};

export const invalidateMaintenanceRatesCache = () => {
  cached = null;
  cachedAt = 0;
};
