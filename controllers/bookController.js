// controllers/bookController.js
const Book = require("../models/Book");
const User = require("../models/User");
const cookie = require("cookie");
const mongoose = require("mongoose");
const {
  Types: { ObjectId },
} = mongoose;

// Import sequential ID utilities
const {
  suggestNextBookID,
  generateBookID,
  isBookIDAvailable,
  syncBookCounter,
} = require("../utils/idGen");

/** Helper: normalize strings */
const norm = (v) => (v === null || v === undefined ? "" : String(v)).trim();

/** Helper: parse int safely (for form inputs) */
const toInt = (v) =>
  v === null || v === undefined || v === "" || Number.isNaN(Number(v))
    ? undefined
    : Number(v);

/** Coerce first defined value into a number (handles "1" as 1) */
function num(...vals) {
  for (const v of vals) {
    if (v === undefined || v === null || v === "") continue;
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return undefined;
}

/** Helper: decide where to redirect after action */
function redirectTarget(req) {
  const ref = String(req.headers.referer || "");
  if (ref.includes("/admin/dashboard")) return "/admin/dashboard";
  if (ref.includes("/books")) return "/books";
  return "/books";
}

/** Helper: find by Mongo _id OR by bookID/BookID (AIPSLIB code) or by numeric tail */
async function findBookByParam(idOrCode) {
  const raw = norm(idOrCode);
  if (!raw) return null;

  // 1) Mongo ObjectId
  if (ObjectId.isValid(raw)) {
    const byId = await Book.findById(raw);
    if (byId) return byId;
  }

  // 2) Exact AIPSLIB code match (bookID/BookID)
  const exact = await Book.findOne({ $or: [{ bookID: raw }, { BookID: raw }] });
  if (exact) return exact;

  // 3) If the param is all digits (e.g., "1285"), try padded and regex variants
  if (/^\d+$/.test(raw)) {
    const rawNum = Number(raw);
    const padded = rawNum < 1000 ? `AIPSLIB${String(rawNum).padStart(4, "0")}` : `AIPSLIB${rawNum}`;

    const byPadded = await Book.findOne({
      $or: [{ bookID: padded }, { BookID: padded }],
    });
    if (byPadded) return byPadded;

    const tailRegex = new RegExp(`^AIPSLIB0*${rawNum}$`, "i");
    const byRegex = await Book.findOne({
      $or: [{ bookID: tailRegex }, { BookID: tailRegex }],
    });
    if (byRegex) return byRegex;
  }

  // 4) Case-insensitive exact match
  const ci = await Book.findOne({
    $or: [
      { bookID: { $regex: `^${raw}$`, $options: "i" } },
      { BookID: { $regex: `^${raw}$`, $options: "i" } },
    ],
  });
  return ci || null;
}

/**
 * GET /books — List all books with pagination, search, and admin controls
 */
exports.listBooks = async (req, res, next) => {
  try {
    const { title = "", author = "", page = 1 } = req.query;
    const perPage = 10;
    const conditions = [];

    // Title filter
    if (title && String(title).trim()) {
      const t = String(title).trim();
      const regex = new RegExp(t, "i");
      conditions.push({ $or: [{ title: regex }, { Title: regex }] });
    }

    // Author filter
    if (author && String(author).trim()) {
      const a = String(author).trim();
      const regex = new RegExp(a, "i");
      conditions.push({ $or: [{ author: regex }, { Author: regex }] });
    }

    const filter = conditions.length > 0 ? { $and: conditions } : {};

    // Calculate total number of books from actual database records
    const totalBooks = await Book.countDocuments(filter);
    const totalPages = Math.max(1, Math.ceil(totalBooks / perPage));

    const requestedPage = parseInt(page, 10) || 1;
    const currentPage = Math.min(Math.max(requestedPage, 1), totalPages);

    const hasResults = totalBooks > 0;
    const books = hasResults
      ? await Book.find(filter)
          .sort({ createdAt: 1, _id: 1 })
          .skip((currentPage - 1) * perPage)
          .limit(perPage)
          .lean()
      : [];

    const titleSearch = req.query.title ? String(req.query.title).trim() : "";
    const authorSearch = req.query.author ? String(req.query.author).trim() : "";
    const searchTerm = titleSearch || authorSearch;

    const notFoundMessage =
      !hasResults && searchTerm
        ? `Sorry, no book or author was found with that name "${searchTerm}".`
        : !hasResults
        ? "Sorry, no book or author was found."
        : "";

    // Determine admin status from cookie
    const cookies = cookie.parse(req.headers.cookie || "");
    const isAdmin = cookies.isAdmin === "1";

    res.render("showBooks", {
      books,
      query: req.query,
      isAdmin,
      currentPage,
      totalPages,
      totalBooks,
      notFoundMessage,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /books/add — Render dedicated Add Book form with auto-prefilled sequential Book ID
 */
exports.renderAddBook = async (req, res, next) => {
  try {
    const nextBookID = await suggestNextBookID();

    res.render("addBook", {
      nextBookID,
      formData: {},
      error: req.query.err || null,
      success: req.query.msg || null,
      query: req.query,
    });
  } catch (err) {
    console.error("renderAddBook error:", err);
    res.render("addBook", {
      nextBookID: "AIPSLIB",
      formData: {},
      error: "Could not auto-generate Book ID. Please enter manually.",
      success: null,
      query: req.query,
    });
  }
};

/**
 * POST /books/add — Create a new book with server-side validation and duplicate prevention
 */
exports.addBook = async (req, res, next) => {
  let submittedBookID = norm(req.body.bookID || req.body.BookID);
  const title = norm(req.body.title || req.body.Title);
  const author = norm(req.body.author || req.body.Author);
  const category = norm(req.body.category || req.body.Category);
  const year = toInt(req.body.year || req.body.Year);
  const totalCopies = toInt(req.body.totalCopies || req.body.TotalCopies) ?? 1;
  let availableCopies = toInt(req.body.availableCopies || req.body.AvailableCopies);
  const shelfNo = norm(req.body.shelfNo || req.body.ShelfNo);
  const shelf = norm(req.body.shelf || req.body.Shelf);

  // If available copies not explicitly specified, default to total copies
  if (availableCopies === undefined && Number.isFinite(totalCopies)) {
    availableCopies = totalCopies;
  }

  // 1. Validate required title
  if (!title) {
    const nextBookID = await suggestNextBookID().catch(() => "AIPSLIB");
    return res.status(400).render("addBook", {
      nextBookID,
      formData: req.body,
      error: "Book title is required.",
      success: null,
      query: req.query,
    });
  }

  // 2. Validate copy counts
  if (totalCopies < 0) {
    const nextBookID = await suggestNextBookID().catch(() => "AIPSLIB");
    return res.status(400).render("addBook", {
      nextBookID,
      formData: req.body,
      error: "Total copies cannot be negative.",
      success: null,
      query: req.query,
    });
  }

  if (availableCopies < 0 || availableCopies > totalCopies) {
    const nextBookID = await suggestNextBookID().catch(() => "AIPSLIB");
    return res.status(400).render("addBook", {
      nextBookID,
      formData: req.body,
      error: `Available copies must be between 0 and total copies (${totalCopies}).`,
      success: null,
      query: req.query,
    });
  }

  try {
    let finalBookID = submittedBookID;

    // 3. Handle Book ID generation & duplicate checking
    if (finalBookID) {
      // Validate uniqueness if manually provided or prefilled
      const isAvailable = await isBookIDAvailable(finalBookID);
      if (!isAvailable) {
        const nextSuggested = await suggestNextBookID().catch(() => "AIPSLIB");
        return res.status(400).render("addBook", {
          nextBookID: nextSuggested,
          formData: req.body,
          error: `Book ID "${finalBookID}" is already in use by another book. Please choose a different ID or use the suggested ID.`,
          success: null,
          query: req.query,
        });
      }
    } else {
      // Atomically allocate the next sequential ID
      finalBookID = await generateBookID();
    }

    // 4. Save new book document (populate both PascalCase and camelCase for schema/query compatibility)
    const doc = {
      BookID: finalBookID,
      bookID: finalBookID,
      Title: title,
      title: title,
      Author: author,
      author: author,
      Category: category,
      category: category,
      Year: year,
      year: year,
      TotalCopies: totalCopies,
      totalCopies: totalCopies,
      AvailableCopies: availableCopies,
      availableCopies: availableCopies,
      ShelfNo: shelfNo,
      shelfNo: shelfNo,
      Shelf: shelf,
      shelf: shelf,
      borrowers: [],
    };

    const created = await Book.create(doc);

    // Force-write the raw `bookID` field using the native driver.
    // Mongoose treats `bookID` as an alias for `BookID` and may not persist
    // the camelCase field as its own key in MongoDB. Raw writes ensure both
    // BookID and bookID are always present so queries using either key work.
    await mongoose.connection.collection("books").updateOne(
      { _id: created._id },
      { $set: { bookID: finalBookID } }
    );

    // Keep atomic counter in sync with inserted book ID
    syncBookCounter().catch((err) => {
      console.warn("Could not sync counter after book addition:", err.message);
    });

    return res.redirect(
      "/books?msg=" + encodeURIComponent(`Book "${title}" (${finalBookID}) added successfully.`)
    );
  } catch (err) {
    console.error("addBook error:", err);

    const nextBookID = await suggestNextBookID().catch(() => "AIPSLIB");

    // Duplicate key error in MongoDB (E11000)
    if (err.code === 11000) {
      return res.status(400).render("addBook", {
        nextBookID,
        formData: req.body,
        error: `Duplicate Book ID "${submittedBookID || 'unknown'}". Another record already uses this ID.`,
        success: null,
        query: req.query,
      });
    }

    return res.status(500).render("addBook", {
      nextBookID,
      formData: req.body,
      error: `Failed to add book: ${err.message}`,
      success: null,
      query: req.query,
    });
  }
};

/**
 * POST /books/update/:id — Update book fields including human-readable Book ID
 * Preserves MongoDB internal _id, rejects duplicates, and preserves other relationships.
 */
exports.updateBook = async (req, res, next) => {
  try {
    const book = await findBookByParam(req.params.id);
    if (!book) {
      return res.redirect(
        redirectTarget(req) + "?err=" + encodeURIComponent("Book not found.")
      );
    }

    const currentBookID = (book.BookID || book.bookID || "").trim();
    let newBookID = norm(
      req.body.bookID || req.body.BookID || req.body.updateBookId
    );

    // Auto-normalize AIPSLIB prefix to uppercase (e.g. aipslib1286 -> AIPSLIB1286)
    if (/^aipslib/i.test(newBookID)) {
      newBookID = "AIPSLIB" + newBookID.slice(7);
    }

    // If Book ID was changed, check for duplicates against other books
    if (newBookID && newBookID !== currentBookID) {
      const isAvailable = await isBookIDAvailable(newBookID, book._id);
      if (!isAvailable) {
        return res.redirect(
          redirectTarget(req) +
            "?err=" +
            encodeURIComponent(`Cannot update Book ID: "${newBookID}" is already used by another book.`)
        );
      }
      book.BookID = newBookID;
      book.bookID = newBookID;
      book.set("BookID", newBookID);
      book.set("bookID", newBookID);
      book.markModified("BookID");
    }

    // Update text fields
    const title = norm(req.body.title || req.body.Title);
    const author = norm(req.body.author || req.body.Author);
    const category = norm(req.body.category || req.body.Category);
    const year = toInt(req.body.year || req.body.Year);
    const shelfNo = norm(req.body.shelfNo || req.body.ShelfNo);
    const shelf = norm(req.body.shelf || req.body.Shelf);

    if (title) {
      book.Title = title;
      book.title = title;
    }
    if (author !== undefined) {
      book.Author = author;
      book.author = author;
    }
    if (category !== undefined) {
      book.Category = category;
      book.category = category;
    }
    if (year !== undefined) {
      book.Year = year;
      book.year = year;
    }
    if (shelfNo !== undefined) {
      book.ShelfNo = shelfNo;
      book.shelfNo = shelfNo;
    }
    if (shelf !== undefined) {
      book.Shelf = shelf;
      book.shelf = shelf;
    }

    // Update copy counts safely
    const newTotal = toInt(req.body.totalCopies || req.body.TotalCopies);
    const newAvail = toInt(req.body.availableCopies || req.body.AvailableCopies);

    if (newTotal !== undefined && newTotal >= 0) {
      book.TotalCopies = newTotal;
      book.totalCopies = newTotal;
    }

    const currentTotal = num(book.TotalCopies, book.totalCopies, 0) ?? 0;
    if (newAvail !== undefined) {
      const clampedAvail = Math.max(0, Math.min(newAvail, currentTotal));
      book.AvailableCopies = clampedAvail;
      book.availableCopies = clampedAvail;
    } else if (newTotal !== undefined) {
      // Ensure available copies does not exceed new total
      const currAvail = num(book.AvailableCopies, book.availableCopies, 0) ?? 0;
      if (currAvail > currentTotal) {
        book.AvailableCopies = currentTotal;
        book.availableCopies = currentTotal;
      }
    }

    await book.save();

    // Directly update the native MongoDB collection to persist BOTH BookID and
    // bookID fields. We intentionally bypass Mongoose here because Mongoose
    // treats `bookID` as an alias for `BookID` and silently ignores the
    // camelCase key in updateOne, leaving the raw `bookID` field in MongoDB
    // unchanged and causing the old ID to still display after save.
    if (newBookID && newBookID !== currentBookID) {
      await mongoose.connection.collection("books").updateOne(
        { _id: book._id },
        { $set: { BookID: newBookID, bookID: newBookID } }
      );
      syncBookCounter().catch((err) => {
        console.warn("Could not sync counter after Book ID update:", err.message);
      });
    }

    const finalSavedID = newBookID || currentBookID;
    return res.redirect(
      redirectTarget(req) +
        "?msg=" +
        encodeURIComponent(`Book "${book.Title || book.title}" (${finalSavedID}) updated successfully.`)
    );
  } catch (err) {
    console.error("updateBook error:", err);
    return res.redirect(
      redirectTarget(req) + "?err=" + encodeURIComponent(`Update failed: ${err.message}`)
    );
  }
};

/**
 * POST /books/delete/:id — Safe Book Deletion
 * Checks for active book issues and borrowers before deleting.
 * Protects issue/return history and relationships.
 */
exports.deleteBook = async (req, res, next) => {
  try {
    const book = await findBookByParam(req.params.id);
    if (!book) {
      return res.redirect(
        redirectTarget(req) + "?err=" + encodeURIComponent("Book not found.")
      );
    }

    const bookID = book.BookID || book.bookID || "Unknown ID";
    const title = book.Title || book.title || "Untitled";

    // Check for active issues before allowing deletion
    const total = num(book.TotalCopies, book.totalCopies, 0) ?? 0;
    const available = num(book.AvailableCopies, book.availableCopies, total) ?? total;
    const issuedCount = Math.max(0, total - available);
    const borrowerCount = Array.isArray(book.borrowers) ? book.borrowers.length : 0;
    const activeCount = Math.max(issuedCount, borrowerCount);

    if (activeCount > 0) {
      return res.redirect(
        redirectTarget(req) +
          "?err=" +
          encodeURIComponent(
            `Cannot delete "${title}" (${bookID}): It currently has ${activeCount} active issued copy/copies. Please ensure all copies are returned before deleting.`
          )
      );
    }

    // Safely delete only the intended record by its MongoDB _id
    await Book.findByIdAndDelete(book._id);

    return res.redirect(
      redirectTarget(req) +
        "?msg=" +
        encodeURIComponent(`Book "${title}" (${bookID}) was deleted successfully.`)
    );
  } catch (err) {
    console.error("deleteBook error:", err);
    return res.redirect(
      redirectTarget(req) + "?err=" + encodeURIComponent(`Failed to delete book: ${err.message}`)
    );
  }
};

/**
 * GET /books/lookup/:id — JSON lookup for modals/autocomplete
 */
exports.lookupBook = async (req, res, next) => {
  try {
    const book = await findBookByParam(req.params.id);
    if (!book) {
      return res.status(404).json({ ok: false, msg: "Book not found." });
    }

    const total = num(book.totalCopies, book.TotalCopies, 0) ?? 0;
    const availableRaw = num(book.availableCopies, book.AvailableCopies);
    const available =
      availableRaw === undefined && total > 0 ? total : availableRaw ?? 0;

    return res.json({
      ok: true,
      data: {
        _id: String(book._id),
        bookID: book.bookID || book.BookID || "",
        title: book.title || book.Title || "",
        author: book.author || book.Author || "",
        category: book.category || book.Category || "",
        year: book.year || book.Year || "",
        shelfNo: book.shelfNo || book.ShelfNo || "",
        shelf: book.shelf || book.Shelf || "",
        total,
        available,
        canIssue: available > 0,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /books/issue/:id
 */
exports.issueBook = async (req, res, next) => {
  try {
    const book = await findBookByParam(req.params.id);
    if (!book) {
      return res.redirect(
        redirectTarget(req) + "?err=" + encodeURIComponent("Book not found.")
      );
    }

    const total = num(book.totalCopies, book.TotalCopies, 0) ?? 0;
    let available = num(book.availableCopies, book.AvailableCopies);
    if (available === undefined && total > 0) available = total;
    available = available ?? 0;

    if (available <= 0) {
      return res.redirect(
        redirectTarget(req) +
          "?err=" +
          encodeURIComponent("No copies available to issue.")
      );
    }

    const { userId } = req.body;
    let member = null;
    if (userId) {
      try {
        member = await User.findById(userId);
      } catch {
        member = null;
      }
    }

    const updateDoc = {
      $inc: { availableCopies: -1, AvailableCopies: -1 },
    };
    if (member) {
      updateDoc.$push = { borrowers: member._id };
    }

    const updated = await Book.findOneAndUpdate(
      {
        _id: book._id,
        $or: [{ availableCopies: { $gt: 0 } }, { AvailableCopies: { $gt: 0 } }],
      },
      updateDoc,
      { new: true }
    );

    if (!updated) {
      return res.redirect(
        redirectTarget(req) +
          "?err=" +
          encodeURIComponent("No copies available to issue.")
      );
    }

    let msg = "Book issued successfully.";
    if (member) {
      msg = `Book issued successfully to ${member.fullName} (${member.memberID}).`;
    }
    return res.redirect(redirectTarget(req) + "?msg=" + encodeURIComponent(msg));
  } catch (err) {
    next(err);
  }
};

/**
 * POST /books/return/:id
 */
exports.returnBook = async (req, res, next) => {
  try {
    const book = await findBookByParam(req.params.id);
    if (!book) {
      return res.redirect(
        redirectTarget(req) + "?err=" + encodeURIComponent("Book not found.")
      );
    }

    const total = num(book.totalCopies, book.TotalCopies, 0) ?? 0;
    let available = num(book.availableCopies, book.AvailableCopies);
    if (available === undefined) available = 0;

    const { userId } = req.body;
    let member = null;
    if (userId) {
      try {
        member = await User.findById(userId);
      } catch {
        member = null;
      }
    }

    if (total > 0 && available >= total) {
      return res.redirect(
        redirectTarget(req) +
          "?err=" +
          encodeURIComponent("All copies already returned.")
      );
    }

    const newAvailable = total > 0 ? Math.min(available + 1, total) : available + 1;
    book.availableCopies = newAvailable;
    book.AvailableCopies = newAvailable;

    if (book.borrowers && book.borrowers.length) {
      if (member) {
        const idx = book.borrowers.findIndex((id) => id.toString() === userId);
        if (idx !== -1) {
          book.borrowers.splice(idx, 1);
        }
      } else {
        book.borrowers.shift();
      }
    }

    await book.save();

    let msg = "Book returned successfully.";
    if (member) {
      msg = `Book returned successfully by ${member.fullName} (${member.memberID}).`;
    }
    return res.redirect(redirectTarget(req) + "?msg=" + encodeURIComponent(msg));
  } catch (err) {
    next(err);
  }
};
