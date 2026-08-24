import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from './config/db.js';
import Customer from './models/Customer.js';

dotenv.config();

const run = async () => {
  try {
    await connectDB();
    
    // Find some records that match the phone numbers in the screenshots
    // e.g. 010-2618-0660 or 010-8833-3344 or 010-5419-3289
    const testPhones = ['01026180660', '01088333344', '01054193289'];
    
    const cleanPhone = (p) => p ? p.replace(/\D/g, '') : '';
    
    const customers = await Customer.find({});
    
    console.log('--- Printing details of matching customers ---');
    let count = 0;
    for (const c of customers) {
      const phones = [c.contactPhone, c.mobilePhone, c.businessPhone, c.homePhone].map(cleanPhone);
      const matched = phones.some(p => testPhones.includes(p));
      
      if (matched && count < 5) {
        console.log(`\nCustomer ID: ${c.customerId}`);
        console.log(`name (Long Display): "${c.name}"`);
        console.log(`surname (성): "${c.surname}"`);
        console.log(`givenName (이름): "${c.givenName}"`);
        console.log(`displayName: "${c.displayName}"`);
        console.log(`jobTitle: "${c.jobTitle}"`);
        console.log(`contactName: "${c.contactName}"`);
        count++;
      }
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    mongoose.connection.close();
  }
};

run();
