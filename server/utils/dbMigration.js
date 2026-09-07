import Customer from '../models/Customer.js';
import Contract from '../models/Contract.js';
import User from '../models/User.js';
import Vehicle from '../models/Vehicle.js';

export const runDatabaseMigration = async () => {
  try {
    console.log('--- Database Migration Started ---');

    // 1. 고객 코드(customerId)가 없는 고객에게만 코드를 매긴다.
    //
    // 예전에는 고객 1만 8천 건을 전부 메모리로 읽어 하나씩 확인했다. 바꿀 게 하나도 없어도
    // 서버가 켜질 때마다 7초가 걸렸고, 배포 직후 첫 화면이 그만큼 늦게 떴다.
    // 먼저 세어 보고, 매길 게 있을 때만 읽는다.
    const missingIdFilter = {
      $or: [{ customerId: { $exists: false } }, { customerId: null }, { customerId: '' }]
    };
    const missingIdCount = await Customer.countDocuments(missingIdFilter);

    if (missingIdCount === 0) {
      console.log('All customers already have customerId.');
    } else {
      // 이미 쓰고 있는 가장 큰 번호 다음부터 이어 붙인다.
      // (번호 문자열로 정렬하면 CUST999가 CUST1000보다 뒤로 가므로 숫자로 뽑아 최댓값을 본다)
      const [maxRow] = await Customer.aggregate([
        { $match: { customerId: /^CUST\d+$/ } },
        { $project: { seq: { $toInt: { $substrBytes: ['$customerId', 4, 10] } } } },
        { $group: { _id: null, maxSeq: { $max: '$seq' } } }
      ]);
      let nextSeq = (maxRow?.maxSeq || 0) + 1;

      const customersWithoutId = await Customer.find(missingIdFilter).sort({ createdAt: 1 });
      for (const customer of customersWithoutId) {
        customer.customerId = `CUST${String(nextSeq).padStart(3, '0')}`;
        await customer.save();
        console.log(`Migrated Customer [${customer.name}]: Assigned customerId = ${customer.customerId}`);
        nextSeq += 1;
      }
      console.log(`Successfully migrated ${customersWithoutId.length} customers.`);
    }

    // 2. 계약번호가 비어 있는 계약에만 번호를 채운다.
    //
    // 예전에는 서버가 켜질 때마다 모든 계약번호를 [customerId]-[YYMM]-[Seq]로 다시 매겼는데,
    // 그러면 회사에서 실제로 쓰는 번호(21100001 등)가 재시작 한 번에 사라진다.
    // 계약번호는 이미 나간 계약서·세금계산서에 찍혀 있고, 청구서 폴더 경로
    // (RENT/계약자/02.청구서/계약번호/)도 이 번호로 만들어져 있어 바꾸면 파일을 못 찾는다.
    // 그래서 번호가 없는 계약만 채우고, 이미 있는 번호는 건드리지 않는다.
    const contracts = await Contract.find({
      $or: [{ contractNo: { $exists: false } }, { contractNo: null }, { contractNo: '' }]
    }).populate('customer').sort({ createdAt: 1 });
    let migratedContractsCount = 0;

    // Track sequence per customer per month
    const customerMonthSeqTracker = {}; // Key format: "customerId-YYMM" -> count

    for (const contract of contracts) {
      if (!contract.customer) {
        console.warn(`Contract [${contract.contractNo}] has no linked customer. Skipping migration.`);
        continue;
      }

      const cId = contract.customer.customerId || 'CUST000';
      const contractDateObj = new Date(contract.contractDate || contract.createdAt);
      const yy = String(contractDateObj.getFullYear()).slice(-2);
      const mm = String(contractDateObj.getMonth() + 1).padStart(2, '0');
      const yymm = `${yy}${mm}`;
      const trackerKey = `${cId}-${yymm}`;

      // Increment sequence
      if (!customerMonthSeqTracker[trackerKey]) {
        customerMonthSeqTracker[trackerKey] = 0;
      }
      customerMonthSeqTracker[trackerKey]++;

      // 이미 쓰고 있는 번호와 겹치지 않을 때까지 다음 순번으로 넘긴다
      let newNo = '';
      while (!newNo) {
        const seq = String(customerMonthSeqTracker[trackerKey]).padStart(2, '0');
        const candidate = `${cId}-${yymm}-${seq}`;
        if (await Contract.findOne({ contractNo: candidate })) {
          customerMonthSeqTracker[trackerKey] += 1;
        } else {
          newNo = candidate;
        }
      }

      contract.contractNo = newNo;
      await contract.save();
      migratedContractsCount++;
      console.log(`계약번호를 채웠습니다: [${newNo}]`);
    }

    if (migratedContractsCount > 0) {
      console.log(`계약번호가 없던 계약 ${migratedContractsCount}건에 번호를 채웠습니다.`);
    } else {
      console.log('계약번호가 없는 계약은 없습니다.');
    }

    // 3. Migrate Users (Ensure admin account has role: 'admin')
    const adminUser = await User.findOne({ email: 'admin@rentbenefit.co.kr' });
    if (adminUser && adminUser.role !== 'admin') {
      adminUser.role = 'admin';
      await adminUser.save();
      console.log('Migrated admin user: Assigned role = admin');
    }

    // 4. Migrate Users (Grandfather in accounts created before the approval-based
    // signup system existed - without this, the new required/status fields would
    // lock every pre-existing account out of login)
    const legacyUsers = await User.find({
      $or: [
        { status: { $exists: false } },
        { phone: { $exists: false } },
        { department: { $exists: false } },
        { agreedToTerms: { $exists: false } },
      ],
    });
    let migratedUsersCount = 0;
    for (const legacyUser of legacyUsers) {
      if (!legacyUser.status || legacyUser.status === 'PENDING') {
        legacyUser.status = 'ACTIVE';
      }
      if (!legacyUser.phone) legacyUser.phone = '미등록';
      if (!legacyUser.department) legacyUser.department = '미등록';
      if (!legacyUser.agreedToTerms) legacyUser.agreedToTerms = true;
      await legacyUser.save();
      migratedUsersCount++;
    }
    if (migratedUsersCount > 0) {
      console.log(`Migrated ${migratedUsersCount} legacy user(s): backfilled status/phone/department/agreedToTerms.`);
    } else {
      console.log('All users already have status/phone/department/agreedToTerms.');
    }

    // 4. 차량 상태 '예약' -> '계약중'.
    //
    // 두 값의 뜻이 같았다(계약은 됐고 아직 출고 전). 화면에 둘 다 있으니 같은 차가
    // 사람마다 다른 칸으로 들어가 집계가 갈렸다. 렌트차량 DB에서 '예약'을 없애고
    // '계약중' 하나로 합치면서, 이미 '예약'으로 저장된 차량도 함께 옮긴다.
    // 이미 옮겼으면 대상이 0건이라 그냥 지나간다.
    const reservedResult = await Vehicle.updateMany(
      { status: '예약' },
      { $set: { status: '계약중' } }
    );
    if (reservedResult.modifiedCount > 0) {
      console.log(`Migrated ${reservedResult.modifiedCount} vehicle(s): status '예약' -> '계약중'.`);
    } else {
      console.log("No vehicles left with status '예약'.");
    }

    console.log('--- Database Migration Completed Successfully ---');
  } catch (error) {
    console.error('Error during database migration:', error.message);
  }
};
