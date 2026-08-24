import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from './config/db.js';
import User from './models/User.js';

dotenv.config();

const run = async () => {
  try {
    await connectDB();
    
    // Check if doosik4947@gmail.com already exists
    let user4947 = await User.findOne({ email: 'doosik4947@gmail.com' });
    if (user4947) {
      console.log('User doosik4947@gmail.com already exists.');
      return;
    }
    
    // Get details from doosik@rentbenefit.com to copy them
    const sourceUser = await User.findOne({ email: 'doosik@rentbenefit.com' });
    if (!sourceUser) {
      console.log('Source user doosik@rentbenefit.com not found. Creating default doosik4947@gmail.com admin.');
      const newUser = new User({
        email: 'doosik4947@gmail.com',
        name: '이두식',
        password: 'Tls0300**', // will be hashed automatically
        user_type: 'admin',
        role: 'admin',
        status: 'ACTIVE',
        phone: '010-0000-0000',
        department: '대표',
        agreedToTerms: true
      });
      await newUser.save();
      console.log('Created doosik4947@gmail.com with password Tls0300**');
      return;
    }

    // Create new user using source user details
    const newUser = new User({
      email: 'doosik4947@gmail.com',
      name: sourceUser.name,
      password: 'Tls0300**', // copy password
      user_type: sourceUser.user_type,
      role: sourceUser.role,
      status: 'ACTIVE',
      phone: sourceUser.phone || '010-0000-0000',
      department: sourceUser.department || '대표',
      agreedToTerms: true,
      address: sourceUser.address || ''
    });
    
    await newUser.save();
    console.log(`Created doosik4947@gmail.com copying details from doosik@rentbenefit.com. Password is set to Tls0300**`);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    mongoose.connection.close();
  }
};

run();
