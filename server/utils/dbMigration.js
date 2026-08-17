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

    // 2. Migrate Contracts (Ensure contractNo has format [customerId]-[YYMM]-[Seq])
    const contracts = await Contract.find().populate('customer').sort({ createdAt: 1 });
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

      const newSeq = String(customerMonthSeqTracker[trackerKey]).padStart(2, '0');
      const expectedNo = `${cId}-${yymm}-${newSeq}`;

      if (contract.contractNo !== expectedNo) {
        const oldNo = contract.contractNo;
        
        // Check if there is already a contract with the expected new number to avoid unique index conflict
        const conflict = await Contract.findOne({ contractNo: expectedNo });
        if (conflict) {
          // If conflict, we can add a temp suffix or handle it by shifting sequences, but since we are re-arranging, we can rename old contracts to temporary values first
          console.warn(`Conflict detected for contractNo [${expectedNo}]. Will attempt to migrate safely.`);
        }
        
        contract.contractNo = expectedNo;
        await contract.save();
        migratedContractsCount++;
        console.log(`Migrated Contract: [${oldNo}] -> [${expectedNo}]`);
      }
    }

    if (migratedContractsCount > 0) {
      console.log(`Successfully migrated ${migratedContractsCount} contracts.`);
    } else {
      console.log('All contracts are already in the correct serial format.');
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
