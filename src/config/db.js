const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/cfo_flow_db';
  try {
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000
    });
    console.log(`✓ MongoDB Connected: ${conn.connection.host}`);
    return conn;
  } catch (err) {
    console.error('✗ MongoDB Connection Error:', err.message);
    console.warn('⚠️ Server will run in offline mode (LocalStorage sync) until MongoDB is connected.');
    return null;
  }
}

module.exports = connectDB;
