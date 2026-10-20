const express = require("express");
const router = express.Router();
const cookie = require("cookie");
const bookController = require("../controllers/bookController");

/**
 * Middleware to require admin authentication for sensitive operations.
 * Checks for isAdmin cookie matching existing admin login system.
 */
function requireAdmin(req, res, next) {
  const cookies = cookie.parse(req.headers.cookie || "");
  if (cookies.isAdmin === "1") {
    return next();
  }
  return res.redirect(
    "/admin/login?msg=" + encodeURIComponent("Admin login required to perform this action.")
  );
}

/**
 * Books Routes
 */

// List all books (Public view, shows admin controls when logged in)
router.get("/", bookController.listBooks);

// Show dedicated Add Book form (Admin only, prefilled with next sequential Book ID)
router.get("/add", requireAdmin, bookController.renderAddBook);

// Add a new book (Admin only)
router.post("/add", requireAdmin, bookController.addBook);

// Update an existing book (Admin only)
router.post("/update/:id", requireAdmin, bookController.updateBook);

// Delete a book (Admin only, safe check for active issues)
router.post("/delete/:id", requireAdmin, bookController.deleteBook);

// Lookup book details (by Mongo _id or custom bookID like AIPSLIB000123) → JSON
router.get("/lookup/:id", bookController.lookupBook);

// Issue a book (Admin only)
router.post("/issue/:id", requireAdmin, bookController.issueBook);

// Return a book (Admin only)
router.post("/return/:id", requireAdmin, bookController.returnBook);

module.exports = router;
