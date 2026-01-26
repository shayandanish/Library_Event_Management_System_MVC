// controllers/bookController.js
const Book = require("../models/Book");
const User = require("../models/User");
// We use the cookie module to parse raw cookie headers in order to
// determine whether the current request is from an authenticated admin.
const cookie = require("cookie");
const {
  Types: { ObjectId },
} = require("mongoose");

// Import our ID generator to generate new book IDs atomically.
const { generateBookID } = require("../utils/idGen");

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

/** Extract numeric tail from an AIPSLIB-style id (e.g., AIPSLIB000123 -> 123) */
function extractTailNum(s) {
  const x = norm(s);
  if (!x.startsWith("AIPSLIB")) return undefined;
  const n = x.slice("AIPSLIB".length);
  const numVal = Number(n);
  return Number.isFinite(numVal) ? numVal : undefined;
}

/**
 * Generate the next BookID using the atomic counter.  This replaces the
 * previous implementation that scanned all books to find the highest
 * numeric suffix.  By delegating to the Counter model via generateBookID,
 * concurrent requests will not collide and each call will produce a
 * unique identifier.
 */
async function generateNextBookID() {
  return generateBookID("AIPSLIB", 6);
}

/** Helper: decide where to redirect after action */
function redirectTarget(req) {
  const ref = String(req.headers.referer || "");
  return ref.includes("/books") ? "/books" : "/";
}

/** Helper: find by Mongo _id OR by bookID/BookID (AIPSLIB code) or by numeric tail */
async function findBookByParam(idOrCode) {
  const raw = norm(idOrCode);

  // 1) Mongo ObjectId
  if (ObjectId.isValid(raw)) {
    const byId = await Book.findById(raw);
    if (byId) return byId;
  }

  // 2) Exact AIPSLIB code match (bookID/BookID)
  const exact = await Book.findOne({ $or: [{ bookID: raw }, { BookID: raw }] });
  if (exact) return exact;

  // 3) If the param is all digits (e.g., "2"), try padded and regex variants
  if (/^\d+$/.test(raw)) {
    const padded = `AIPSLIB${String(Number(raw)).padStart(6, "0")}`;

    // Try exact padded first
    const byPadded = await Book.findOne({
      $or: [{ bookID: padded }, { BookID: padded }],
    });
    if (byPadded) return byPadded;

    // Try regex that matches any AIPSLIB with zero-padded or non-padded tail equal to these digits
    const tailRegex = new RegExp(`^AIPSLIB0*${Number(raw)}$`, "i");
    const byRegex = await Book.findOne({
      $or: [{ bookID: tailRegex }, { BookID: tailRegex }],
    });
    if (byRegex) return byRegex;
  }

  // 4) As a last resort, try case-insensitive match on bookID fields
  const ci = await Book.findOne({
    $or: [
      { bookID: { $regex: `^${raw}$`, $options: "i" } },
      { BookID: { $regex: `^${raw}$`, $options: "i" } },
    ],
  });
  return ci || null;
}

//

/** GET /books — list with add form */exports.listBooks = async (req, res, next) => {
  try {
    const { title = "", author = "", page = 1 } = req.query; // Default page = 1
    const perPage = 10; // Books per page
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

    // Build the final MongoDB filter
    const filter = conditions.length > 0 ? { $and: conditions } : {};

    // Calculate the total number of books
    const totalBooks = await Book.countDocuments(filter);
    const totalPages = Math.max(1, Math.ceil(totalBooks / perPage)); // Avoid zero pages

    // Ensure currentPage is within valid bounds
    const requestedPage = parseInt(page, 10) || 1;
    const currentPage = Math.min(Math.max(requestedPage, 1), totalPages);

    // When no results, skip querying and show a friendly message
    const hasResults = totalBooks > 0;
    const books = hasResults
      ? await Book.find(filter)
          .sort({ createdAt: 1, _id: 1 })
          .skip((currentPage - 1) * perPage) // Skip books from previous pages
          .limit(perPage) // Limit to perPage number of books
          .lean()
      : [];
    
    // Not-found message that echoes the user's search query (title/author)
    // Format: 'Sorry, no book or author was found with that name [search term].'
    const titleSearch = req.query.title ? String(req.query.title).trim() : "";
    const authorSearch = req.query.author ? String(req.query.author).trim() : "";
    // Use title if available, otherwise use author, otherwise empty
    const searchTerm = titleSearch || authorSearch;

    const notFoundMessage = !hasResults && searchTerm
      ? `Sorry, no book or author was found with that name ${searchTerm}.`
      : !hasResults
      ? "Sorry, no book or author was found with that name."
      : "";

    // Determine admin status by inspecting the isAdmin cookie
    const cookies = cookie.parse(req.headers.cookie || "");
    const isAdmin = cookies.isAdmin === "1";

    // Render the page with books and pagination data
    res.render("showBooks", {
      books,
      query: req.query,
      isAdmin,
      currentPage,
      totalPages,
      totalBooks, // Pass totalBooks to display
      notFoundMessage, // Pass the notFoundMessage to the view
    });
  } catch (err) {
    next(err);
  }
};


/** POST /books/add */
exports.addBook = async (req, res, next) => {
  try {
    // Map inputs (support both lowercase and legacy names)
    let bookID = norm(req.body.bookID || req.body.BookID);
    if (!bookID) bookID = await generateNextBookID();

    let totalCopies = toInt(req.body.totalCopies || req.body.TotalCopies);
    let availableCopies = toInt(
      req.body.availableCopies || req.body.AvailableCopies
    );

    // If available not provided, default to total
    if (availableCopies === undefined && Number.isFinite(totalCopies)) {
      availableCopies = totalCopies;
    }

    const doc = {
      bookID,
      title: norm(req.body.title || req.body.Title),
      author: norm(req.body.author || req.body.Author),
      category: norm(req.body.category || req.body.Category),
      year: toInt(req.body.year || req.body.Year),
      totalCopies,
      availableCopies,
      shelfNo: norm(req.body.shelfNo || req.body.ShelfNo),
      shelf: norm(req.body.shelf || req.body.Shelf),
    };

    await Book.create(doc);
    res.redirect("/books");
  } catch (err) {
    next(err);
  }
};
/** POST /books/update/:id  (accepts _id OR AIPSLIB code) */
/** POST /books/update/:id  (accepts _id OR AIPSLIB code) */
exports.updateBook = async (req, res, next) => {
  try {
    const book = await findBookByParam(req.params.id);
    if (!book) {
      return res.redirect(
        redirectTarget(req) + "?msg=" + encodeURIComponent("Book not found.")
      );
    }

    // Build update payload from form (lowercase or legacy)
    const update = {
      title: norm(req.body.title || req.body.Title),
      author: norm(req.body.author || req.body.Author),
      category: norm(req.body.category || req.body.Category),
      year: toInt(req.body.year || req.body.Year),
      totalCopies: toInt(req.body.totalCopies || req.body.TotalCopies),
      availableCopies: toInt(
        req.body.availableCopies || req.body.AvailableCopies
      ),
      shelfNo: norm(req.body.shelfNo || req.body.ShelfNo),
      shelf: norm(req.body.shelf || req.body.Shelf),
    };

    // Remove empty/undefined
    for (const k of Object.keys(update)) {
      if (update[k] === undefined || update[k] === "") delete update[k];
    }

    // Clamp available to total if needed
    const newTotal =
      update.totalCopies ?? num(book.totalCopies, book.TotalCopies);
    let newAvail =
      update.availableCopies ?? num(book.availableCopies, book.AvailableCopies);

    if (newTotal !== undefined && newAvail === undefined) {
      newAvail = Math.min(
        num(book.availableCopies, book.AvailableCopies, 0) ?? 0,
        newTotal
      );
    }
    if (newTotal !== undefined && newAvail !== undefined) {
      newAvail = Math.max(0, Math.min(newAvail, newTotal));
    }
    if (newTotal !== undefined) update.totalCopies = newTotal;
    if (newAvail !== undefined) update.availableCopies = newAvail;

    // ✅ Use document.set so aliases map correctly to stored PascalCase fields
    book.set(update);

    // Keep legacy mirrors in sync (so older code paths reading PascalCase still work)
    if (update.totalCopies !== undefined) book.TotalCopies = update.totalCopies;
    if (update.availableCopies !== undefined)
      book.AvailableCopies = update.availableCopies;

    await book.save();
    return res.redirect(
      redirectTarget(req) +
        "?msg=" +
        encodeURIComponent("Book updated successfully.")
    );
  } catch (err) {
    console.error("updateBook error:", err);
    return res.redirect(
      redirectTarget(req) + "?msg=" + encodeURIComponent("Update failed.")
    );
  }
};

/** POST /books/delete/:id */
exports.deleteBook = async (req, res, next) => {
  try {
    await Book.findByIdAndDelete(req.params.id);
    res.redirect("/books");
  } catch (err) {
    next(err);
  }
};

/** GET /books/lookup/:id — JSON lookup for modals/autocomplete */
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

/** POST /books/issue/:id */
exports.issueBook = async (req, res, next) => {
  try {
    const book = await findBookByParam(req.params.id);
    if (!book) {
      return res.redirect(
        redirectTarget(req) + "?msg=" + encodeURIComponent("Book not found.")
      );
    }

    /*
     * Always compute the total and available counts using both the
     * PascalCase and camelCase fields. The helper `num()` coerces strings
     * and numbers safely and returns the first numeric value it finds.  If
     * `availableCopies` is undefined but a total is present, we assume all
     * copies are available initially. This avoids situations where
     * the alias is undefined and would previously cause issuing to silently
     * fail.
     */
    const total = num(book.totalCopies, book.TotalCopies, 0) ?? 0;
    let available = num(book.availableCopies, book.AvailableCopies);
    if (available === undefined && total > 0) available = total;
    available = available ?? 0;

    if (available <= 0) {
      return res.redirect(
        redirectTarget(req) +
          "?msg=" +
          encodeURIComponent("No copies available to issue.")
      );
    }

    /*
     * Optionally associate this issued copy with a member.  If a
     * userId is provided in the POST body and corresponds to an
     * existing user, we'll record that user in the book.borrowers
     * array.  If no user is provided (e.g., issuing from the table
     * view), the issue will still decrement the available count but
     * will not record a borrower.
     */
    const { userId } = req.body;
    let member = null;
    if (userId) {
      try {
        member = await User.findById(userId);
      } catch {
        member = null;
      }
    }

    // Build the atomic update: decrement available copies and push borrower
    const updateDoc = {
      $inc: { availableCopies: -1, AvailableCopies: -1 },
    };
    if (member) {
      updateDoc.$push = { borrowers: member._id };
    }
    /*
     * Perform an atomic update to decrement the available count.  The
     * `availableCopies` field defined in the schema is an alias for
     * `AvailableCopies`.  As explained in the Mongoose documentation,
     * aliases and other virtuals are not stored in MongoDB and cannot
     * be used in queries【893694647605822†L276-L277】.  Querying on the alias
     * silently fails because MongoDB never sees that field.  To
     * correctly enforce that a copy is available we must query on
     * the actual stored field.  We'll include both the camelCase and
     * PascalCase names in an `$or` condition so the query matches
     * whichever field is present.
     */
    const updated = await Book.findOneAndUpdate(
      {
        _id: book._id,
        $or: [{ availableCopies: { $gt: 0 } }, { AvailableCopies: { $gt: 0 } }],
      },
      updateDoc,
      { new: true }
    );
    if (!updated) {
      // Another concurrent request may have consumed the last copy
      return res.redirect(
        redirectTarget(req) +
          "?msg=" +
          encodeURIComponent("No copies available to issue.")
      );
    }
    let msg = "Book issued successfully.";
    if (member) {
      msg = `Book issued successfully to ${member.fullName} (${member.memberID}).`;
    }
    return res.redirect(
      redirectTarget(req) + "?msg=" + encodeURIComponent(msg)
    );
  } catch (err) {
    next(err);
  }
};

/** POST /books/return/:id */
exports.returnBook = async (req, res, next) => {
  try {
    const book = await findBookByParam(req.params.id);
    if (!book) {
      return res.redirect(
        redirectTarget(req) + "?msg=" + encodeURIComponent("Book not found.")
      );
    }

    const total = num(book.totalCopies, book.TotalCopies, 0) ?? 0;
    let available = num(book.availableCopies, book.AvailableCopies);
    // If undefined, treat as 0 (all copies issued)
    if (available === undefined) available = 0;

    // Determine which member is returning the book (optional)
    const { userId } = req.body;
    let member = null;
    if (userId) {
      try {
        member = await User.findById(userId);
      } catch {
        member = null;
      }
    }

    // Prevent exceeding total copies
    if (total > 0 && available >= total) {
      return res.redirect(
        redirectTarget(req) +
          "?msg=" +
          encodeURIComponent("All copies already returned.")
      );
    }

    const newAvailable =
      total > 0 ? Math.min(available + 1, total) : available + 1;
    book.availableCopies = newAvailable;
    book.AvailableCopies = newAvailable;
    // Remove borrower record if possible
    if (book.borrowers && book.borrowers.length) {
      if (member) {
        const idx = book.borrowers.findIndex((id) => id.toString() === userId);
        if (idx !== -1) {
          book.borrowers.splice(idx, 1);
        }
      } else {
        // remove the first borrower if no user specified or found
        book.borrowers.shift();
      }
    }
    await book.save();
    let msg = "Book returned successfully.";
    if (member) {
      msg = `Book returned successfully by ${member.fullName} (${member.memberID}).`;
    }
    return res.redirect(
      redirectTarget(req) + "?msg=" + encodeURIComponent(msg)
    );
  } catch (err) {
    next(err);
  }
};
