// config/db.js
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const Book = require("../models/Book");
require("dotenv").config();

/**
 * Connect to MongoDB and seed the database if empty.
 * Reads the MongoDB URI from the MONGODB_URI environment variable.
 * If undefined, falls back to a local database.
 */
const connectDB = async () => {
  try {
    // Read the MongoDB URI from the MONGODB_URI environment variable.  If it is
    // undefined fall back to a local database.  Avoid hardcoding credentials in
    // source code – load them from your environment or a secrets manager.
    const MONGODB_URI =
      process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/AIPS_library_DB";

    await mongoose.connect(MONGODB_URI);
    console.log("✅ MongoDB Connected");

    // Seed only if empty
    const count = await Book.countDocuments();
    if (count === 0) {
      const seedPath = path.join(__dirname, "..", "data", "books.json");
      const data = JSON.parse(fs.readFileSync(seedPath, "utf-8"));
      await Book.insertMany(data);
      console.log("📥 Books imported from JSON");
    }
  } catch (err) {
    console.error("❌ DB Error:", err);
    process.exit(1);
  }
};

module.exports = connectDB;

