// utils/idGen.js
const Counter = require("../models/Counter");
const Book = require("../models/Book");

/**
 * Format numeric sequence into standard Book ID string:
 * - Prefix is AIPSLIB
 * - Numbers < 1000 are padded with leading zeros to 4 digits (e.g. AIPSLIB0001 ... AIPSLIB0999)
 * - Numbers >= 1000 are unpadded (e.g. AIPSLIB1000 ... AIPSLIB1285, AIPSLIB1286)
 *
 * @param {number} num
 * @param {string} prefix
 * @returns {string}
 */
function formatBookID(num, prefix = "AIPSLIB") {
  const n = parseInt(num, 10);
  if (isNaN(n) || n <= 0) return `${prefix}0001`;
  if (n < 1000) {
    return `${prefix}${String(n).padStart(4, "0")}`;
  }
  return `${prefix}${n}`;
}

/**
 * Extract integer tail from an AIPSLIB-style identifier.
 * E.g. "AIPSLIB0001" -> 1, "AIPSLIB1285" -> 1285, "AIPSLIB10000" -> 10000.
 * Returns null if string does not match.
 *
 * @param {string} idStr
 * @param {string} prefix
 * @returns {number|null}
 */
function extractBookNum(idStr, prefix = "AIPSLIB") {
  if (!idStr || typeof idStr !== "string") return null;
  const regex = new RegExp(`^${prefix}(\\d+)$`, "i");
  const match = idStr.trim().match(regex);
  if (!match) return null;
  const val = parseInt(match[1], 10);
  return Number.isFinite(val) ? val : null;
}

/**
 * Inspect all existing book records in MongoDB to find the highest sequential number
 * in the continuous numbering series.
 *
 * Intelligently ignores outlier manual entries (e.g. a jump from 1285 to 10000,
 * where gap is greater than MAX_CONTINUOUS_GAP = 50).
 *
 * @param {string} prefix
 * @returns {Promise<number>}
 */
async function getHighestApplicableBookNum(prefix = "AIPSLIB") {
  const books = await Book.find(
    {},
    { BookID: 1, bookID: 1 }
  ).lean();

  const numSet = new Set();
  for (const b of books) {
    const rawId = b.BookID || b.bookID;
    const n = extractBookNum(rawId, prefix);
    if (n !== null) {
      numSet.add(n);
    }
  }

  if (numSet.size === 0) return 0;

  const nums = Array.from(numSet).sort((a, b) => a - b);

  let highest = nums[0];
  const MAX_CONTINUOUS_GAP = 50; // Jumps larger than this indicate outlier/arbitrary IDs

  for (let i = 1; i < nums.length; i++) {
    const prev = nums[i - 1];
    const curr = nums[i];
    if (curr - prev > MAX_CONTINUOUS_GAP) {
      // Outlier jump detected (e.g. 1285 -> 10000); stop sequence at prev
      break;
    }
    highest = curr;
  }

  return highest;
}

/**
 * Suggest next sequential Book ID for prefilling in forms without mutating counters.
 * Inspects real MongoDB records and checks for collisions.
 *
 * If highest applicable ID is AIPSLIB1285, next suggested will be AIPSLIB1286.
 *
 * @param {string} prefix
 * @returns {Promise<string>}
 */
async function suggestNextBookID(prefix = "AIPSLIB") {
  const highest = await getHighestApplicableBookNum(prefix);
  const counterDoc = await Counter.findById(prefix).lean();
  const counterSeq = counterDoc && typeof counterDoc.seq === "number" ? counterDoc.seq : 0;

  let candidateNum = Math.max(highest, counterSeq) + 1;

  // Ensure candidate does not collide with any existing record (e.g. outlier 10000)
  while (true) {
    const candidateId = formatBookID(candidateNum, prefix);
    const exists = await Book.exists({
      $or: [{ BookID: candidateId }, { bookID: candidateId }],
    });
    if (!exists) {
      return candidateId;
    }
    candidateNum++;
  }
}

/**
 * Atomically generate the next sequential Book ID using MongoDB Counter.
 * Guarantees no duplicates and is concurrency-safe.
 *
 * @param {string} prefix
 * @returns {Promise<string>}
 */
async function generateBookID(prefix = "AIPSLIB") {
  const highest = await getHighestApplicableBookNum(prefix);

  // Ensure counter is at least at the highest applicable number before incrementing
  await Counter.findOneAndUpdate(
    { _id: prefix, $or: [{ seq: { $lt: highest } }, { seq: { $exists: false } }] },
    { $set: { seq: highest } },
    { upsert: true }
  );

  // Increment counter atomically
  let counterDoc = await Counter.findOneAndUpdate(
    { _id: prefix },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );

  let seqNum = counterDoc.seq;
  if (seqNum <= highest) {
    seqNum = highest + 1;
    await Counter.updateOne({ _id: prefix }, { $set: { seq: seqNum } });
  }

  // Check if this ID is already taken by a manual outlier; if so, skip to next free
  while (true) {
    const candidateId = formatBookID(seqNum, prefix);
    const exists = await Book.exists({
      $or: [{ BookID: candidateId }, { bookID: candidateId }],
    });
    if (!exists) {
      return candidateId;
    }
    counterDoc = await Counter.findOneAndUpdate(
      { _id: prefix },
      { $inc: { seq: 1 } },
      { new: true }
    );
    seqNum = counterDoc.seq;
  }
}

/**
 * Check if a Book ID is available (not already in use by another book).
 *
 * @param {string} bookID
 * @param {string|ObjectId|null} excludeMongoId (optional ID of book being updated)
 * @returns {Promise<boolean>}
 */
async function isBookIDAvailable(bookID, excludeMongoId = null) {
  if (!bookID || typeof bookID !== "string") return false;
  const trimmed = bookID.trim();
  const filter = {
    $or: [
      { BookID: trimmed },
      { bookID: trimmed },
      { BookID: { $regex: `^${trimmed}$`, $options: "i" } },
      { bookID: { $regex: `^${trimmed}$`, $options: "i" } },
    ],
  };
  if (excludeMongoId) {
    filter._id = { $ne: excludeMongoId };
  }
  const count = await Book.countDocuments(filter);
  return count === 0;
}

/**
 * Synchronize the Counter model with the current highest ID in the database.
 *
 * @param {string} prefix
 * @returns {Promise<number>}
 */
async function syncBookCounter(prefix = "AIPSLIB") {
  const highest = await getHighestApplicableBookNum(prefix);
  await Counter.findOneAndUpdate(
    { _id: prefix },
    { $max: { seq: highest } },
    { upsert: true, new: true }
  );
  return highest;
}

/**
 * Atomically increment and return the next sequence number for member entities.
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

module.exports = {
  formatBookID,
  extractBookNum,
  getHighestApplicableBookNum,
  suggestNextBookID,
  generateBookID,
  isBookIDAvailable,
  syncBookCounter,
  generateMemberID,
};
