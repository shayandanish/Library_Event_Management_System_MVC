const mongoose = require("mongoose");

/**
 * Counter model used to generate sequential numeric identifiers for
 * various entities.  Each document in this collection stores a prefix
 * (the `_id` field) and a `seq` counter.  Using the `$inc` operator on
 * `seq` ensures that increments are atomic and will not collide when
 * multiple requests attempt to generate IDs concurrently.
 */
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

module.exports = mongoose.model("Counter", counterSchema);