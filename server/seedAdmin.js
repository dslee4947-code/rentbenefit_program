import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from './config/db.js';
import User from './models/User.js';

dotenv.config();

const seedAdmin = async () => {
  try {
    await connectDB();

    const adminEmail = 'admin@rentbenefit.co.kr';
    const existingAdmin = await User.findOne({ email: adminEmail });

    if (existingAdmin) {
      console.log('Admin account already exists.');
      process.exit(0);
    }

    const admin = new User({
      email: adminEmail,
      name: '이두식',
      password: 'adminpassword123', // This will be automatically hashed by pre-save hook
      user_type: 'admin',
      role: 'admin',
      status: 'ACTIVE',
      phone: '000-0000-0000',
      department: '경영지원팀',
      agreedToTerms: true,
      address: '서울특별시 서초구 양재대로 11길 36'
    });

    await admin.save();
    console.log('=========================================');
    console.log('Seed Successful!');
    console.log(`Email: ${adminEmail}`);
    console.log('Password: adminpassword123');
    console.log('=========================================');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding admin user:', error);
    process.exit(1);
  }
};

seedAdmin();
