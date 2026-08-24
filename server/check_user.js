import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from './config/db.js';
import User from './models/User.js';

dotenv.config();

const run = async () => {
  try {
    await connectDB();
    
    console.log('Searching for users...');
    const user = await User.findOne({ email: 'doosik4947@gmail.com' });
    if (user) {
      console.log('User found:', {
        email: user.email,
        name: user.name,
        user_type: user.user_type,
        role: user.role,
        status: user.status,
        phone: user.phone,
        department: user.department,
        createdAt: user.createdAt
      });
    } else {
      console.log('User doosik4947@gmail.com NOT found.');
      const allUsers = await User.find({}, 'email name role status');
      console.log('Available users in DB:', allUsers);
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    mongoose.connection.close();
  }
};

run();
