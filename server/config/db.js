// MongoDB Connection configuration
import mongoose from 'mongoose';

// Cache the connection on globalThis so hot-reloads (nodemon) and serverless
// invocations reuse the same client instead of opening a new pool per call.
let cached = globalThis._mongooseConn;
if (!cached) {
  cached = globalThis._mongooseConn = { conn: null, promise: null };
}

const connectDB = async () => {
  if (cached.conn) {
    return cached.conn;
  }

  try {
    if (!cached.promise) {
      const dbUri = process.env.MONGODB_ATLAS_URL || process.env.MONGO_URI;
      cached.promise = mongoose.connect(dbUri).then((conn) => {
        const isLocal = dbUri.includes('localhost') || dbUri.includes('127.0.0.1');
        console.log(`MongoDB Connected (${isLocal ? 'Local' : 'Atlas'}): ${conn.connection.host}`);
        return conn;
      });
    }
    cached.conn = await cached.promise;
    return cached.conn;
  } catch (error) {
    cached.promise = null;
    console.error(`Error connecting to MongoDB: ${error.message}`);
    process.exit(1); // Exit process with failure
  }
};

export default connectDB;
