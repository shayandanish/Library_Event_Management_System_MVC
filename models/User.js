// models/User.js
const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    memberID: { type: String, required: true, unique: true, index: true }, // e.g., AIPSMEM0001
    fullName: { type: String, required: true, trim: true }, // member name
    phone: { type: String, trim: true }, // contact number
    email: { type: String, trim: true, lowercase: true }, // gmail (or any email)
    memberType: {
      type: String,
      enum: ["student", "teacher", "staff", "foreigner"],
      required: true,
    },
    gender: { type: String, enum: ["male", "female", "other"], required: true },

    // optional flags
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
