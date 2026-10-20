// config/db.js
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const Book = require("../models/Book");
require("dotenv").config();

/**
 * Global cache for MongoDB connection across serverless invocations (e.g. Vercel).
 * Prevents multiple connections during hot reloads or cold starts.
 */
let cached = global.mongoose;
if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

/**
 * Connect to MongoDB and seed the database if empty.
 * Reads the MongoDB URI from MONGODB_URI or MONGO_URI environment variables.
 * If undefined, falls back to local database.
 */
const connectDB = async () => {
  if (cached.conn && mongoose.connection.readyState === 1) {
    return cached.conn;
  }

  if (!cached.promise) {
    const MONGODB_URI =
      process.env.MONGODB_URI ||
      process.env.MONGO_URI ||
      "mongodb://127.0.0.1:27017/AIPS_library_DB";

    const opts = {
      bufferCommands: false,
      serverSelectionTimeoutMS: 10000,
    };

    cached.promise = mongoose
      .connect(MONGODB_URI, opts)
      .then(async (m) => {
        console.log("✅ MongoDB Connected");

        // Seed only if empty and data file exists
        try {
          const count = await Book.countDocuments();
          if (count === 0) {
            const seedPath = path.join(__dirname, "..", "data", "books.json");
            if (fs.existsSync(seedPath)) {
              const rawData = fs.readFileSync(seedPath, "utf-8");
              const data = JSON.parse(rawData);
              if (Array.isArray(data) && data.length > 0) {
                await Book.insertMany(data);
                console.log(`📥 Seeded ${data.length} books from books.json`);
              }
            }
          }
        } catch (seedErr) {
          console.warn("⚠️ Database seed check skipped:", seedErr.message);
        }

        return m;
      })
      .catch((err) => {
        cached.promise = null;
        console.error("❌ MongoDB Connection Error:", err.message);
        throw err;
      });
  }

  try {
    cached.conn = await cached.promise;
  } catch (err) {
    cached.promise = null;
    throw err;
  }

  return cached.conn;
};

module.exports = connectDB;
