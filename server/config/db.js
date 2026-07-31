// MongoDB Connection configuration
import mongoose from 'mongoose';

const connectDB = async () => {
  try {
    const dbUri = process.env.MONGODB_ATLAS_URL || process.env.MONGO_URI;
    const conn = await mongoose.connect(dbUri);
    const isLocal = dbUri.includes('localhost') || dbUri.includes('127.0.0.1');
    console.log(`MongoDB Connected (${isLocal ? 'Local' : 'Atlas'}): ${conn.connection.host}`);
  } catch (error) {
    console.error(`Error connecting to MongoDB: ${error.message}`);
    process.exit(1); // Exit process with failure
  }
};

export default connectDB;
