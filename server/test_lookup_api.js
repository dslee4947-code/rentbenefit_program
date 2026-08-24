import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from './config/db.js';
import Customer from './models/Customer.js';

dotenv.config();

const test = async () => {
  try {
    await connectDB();
    
    // Find some customers with phone numbers
    const sampleCustomers = await Customer.find({
      $or: [
        { contactPhone: { $ne: null, $ne: '' } },
        { mobilePhone: { $ne: null, $ne: '' } },
        { businessPhone: { $ne: null, $ne: '' } },
        { homePhone: { $ne: null, $ne: '' } }
      ]
    }).limit(3);

    if (sampleCustomers.length === 0) {
      console.log('No customers with phone numbers found in DB to test.');
      return;
    }

    const testPhones = [];
    console.log('\n--- Selected Test Customers from DB ---');
    sampleCustomers.forEach((c, idx) => {
      const p = c.mobilePhone || c.contactPhone || c.businessPhone || c.homePhone;
      console.log(`${idx + 1}. Name: ${c.name}, CustomerID: ${c.customerId}, Phone: ${p}, Home Address: ${c.homeAddress || 'N/A'}, Biz Address: ${c.businessAddress || 'N/A'}`);
      
      // Let's modify the phone string to test matching (e.g. remove spaces, change dashes)
      testPhones.push(p);
      if (p.includes('-')) {
        testPhones.push(p.replace(/-/g, '')); // no dash version
      } else {
        // Add dashes if no dashes
        testPhones.push(p.slice(0, 3) + '-' + p.slice(3, 7) + '-' + p.slice(7));
      }
    });

    // Add a non-existent phone number to test mismatch
    testPhones.push('010-9999-9999');

    console.log('\n--- Sending POST request to http://localhost:5000/api/customers/lookup-addresses ---');
    console.log('Test Phones:', testPhones);

    const res = await fetch('http://localhost:5000/api/customers/lookup-addresses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ phones: testPhones })
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`HTTP Error ${res.status}: ${text}`);
      return;
    }

    const results = await res.json();
    console.log('\n--- API Lookup Results ---');
    results.forEach((r, idx) => {
      console.log(`\nInput ${idx + 1}: "${r.inputPhone}"`);
      if (r.matched) {
        console.log(`  Status: Matched successfully!`);
        console.log(`  Customer: ${r.name} (${r.customerId})`);
        console.log(`  Home Address: ${r.homeAddress || 'empty'}`);
        console.log(`  Business Address: ${r.businessAddress || 'empty'}`);
      } else {
        console.log(`  Status: Failed to match (Not Found)`);
      }
    });

  } catch (err) {
    console.error('Test error:', err);
  } finally {
    mongoose.connection.close();
  }
};

test();
