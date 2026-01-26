// models/Book.js
const mongoose = require("mongoose");

const bookSchema = new mongoose.Schema(
  {
    // Stored in DB (PascalCase)  ➜  Access in code via camelCase alias
    // Mark BookID as unique so no two books can share the same code.  This is
    // important when generating IDs using counters to avoid duplicates.
    BookID: { type: String, index: true, unique: true, alias: "bookID" },
    Title: { type: String, trim: true, alias: "title" },
    Author: { type: String, trim: true, alias: "author" },
    Category: { type: String, trim: true, alias: "category" },
    Year: { type: Number, alias: "year" },

    TotalCopies: { type: Number, default: 0, alias: "totalCopies" },
    AvailableCopies: { type: Number, default: 0, alias: "availableCopies" },

    ShelfNo: { type: String, trim: true, alias: "shelfNo" },
    Shelf: { type: String, trim: true, alias: "shelf" },

    /**
     * List of current borrowers for this book. Each entry corresponds
     * to the ObjectId of a registered User who has checked out one
     * copy of this book. The number of borrowers should not exceed
     * the total number of copies. When a copy is issued, the user ID
     * will be pushed into this array and availableCopies decremented.
     * When a copy is returned, the corresponding user ID will be
     * removed and availableCopies incremented.
     */
    borrowers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Index underlying stored fields
bookSchema.index({ ShelfNo: 1 });
bookSchema.index({ Shelf: 1 });
bookSchema.index({ Category: 1 });

module.exports = mongoose.model("Book", bookSchema);
