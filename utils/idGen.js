// utils/idGen.js
const User = require("../models/User");
const Counter = require("../models/Counter");

/**
 * Atomically increment and return the next sequence number for the given
 * prefix.  Uses MongoDB's $inc operator on the Counter collection so
 * concurrent calls do not generate duplicate values.  The returned
 * sequence is padded to the desired width and prefixed appropriately.
 *
 * @param {string} prefix String prefix for the ID (e.g., "AIPSMEM")
 * @param {number} width Width of the numeric portion (e.g., 4 means 0001)
 * @returns {Promise<string>} The generated identifier
 */
async function getNextSequence(prefix, width) {
  const doc = await Counter.findOneAndUpdate(
    { _id: prefix },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  const nextNum = doc.seq.toString().padStart(width, "0");
  return `${prefix}${nextNum}`;
}

async function generateMemberID(prefix = "AIPSMEM", width = 4) {
  return getNextSequence(prefix, width);
}

/**
 * Generate a book ID with the given prefix.  Books use the "AIPSLIB" prefix
 * and a six‑digit numeric portion by default.  This function uses the
 * Counter collection to ensure uniqueness.
 *
 * @param {string} prefix
 * @param {number} width
 */
async function generateBookID(prefix = "AIPSLIB", width = 6) {
  return getNextSequence(prefix, width);
}

module.exports = { generateMemberID, generateBookID };
