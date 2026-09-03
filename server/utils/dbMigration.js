import Customer from '../models/Customer.js';
import Contract from '../models/Contract.js';
import User from '../models/User.js';

export const runDatabaseMigration = async () => {
  try {
    console.log('--- Database Migration Started ---');

    // 1. Migrate Customers (Assign unique sequential customerId if missing)
    const customers = await Customer.find().sort({ createdAt: 1 });
    let migratedCustomersCount = 0;
    
    for (let i = 0; i < customers.length; i++) {
      const customer = customers[i];
      if (!customer.customerId) {
        const generatedId = `CUST${String(i + 1).padStart(3, '0')}`;
        customer.customerId = generatedId;
        await customer.save();
        migratedCustomersCount++;
        console.log(`Migrated Customer [${customer.name}]: Assigned customerId = ${generatedId}`);
      }
    }

    if (migratedCustomersCount > 0) {
      console.log(`Successfully migrated ${migratedCustomersCount} customers.`);
    } else {
      console.log('All customers already have customerId.');
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

    console.log('--- Database Migration Completed Successfully ---');
  } catch (error) {
    console.error('Error during database migration:', error.message);
  }
};
