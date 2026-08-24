import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from './config/db.js';
import User from './models/User.js';

dotenv.config();

const passwordsToTest = [
  'Tls0300**',
  'adminpassword123',
  '123456',
  '1234',
  'rentbenefit123'
];

const run = async () => {
  try {
    await connectDB();
    const users = await User.find({});
    
    for (const user of users) {
      console.log(`Checking user: ${user.email} (${user.name})`);
      let foundMatch = false;
      for (const pwd of passwordsToTest) {
        const isMatch = await user.matchPassword(pwd);
        if (isMatch) {
          console.log(`  -> Match found! Password is: "${pwd}"`);
          foundMatch = true;
          break;
        }
      }
      if (!foundMatch) {
        console.log(`  -> No match found in the test list.`);
      }
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    mongoose.connection.close();
  }
};

run();
