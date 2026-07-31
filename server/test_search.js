import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from './config/db.js';
import Customer from './models/Customer.js';

dotenv.config();

const run = async () => {
  await connectDB();
  
  const customerCount = await Customer.countDocuments();
  console.log(`Total Customers in DB: ${customerCount}`);

  console.log('\n--- Customers ---');
  const customers = await Customer.find();
  customers.forEach(c => {
    console.log(`- ID: ${c._id}, CustomerID: ${c.customerId}, Name: "${c.name}", BizNo: "${c.bizNo}"`);
  });

  mongoose.connection.close();
};

run();
