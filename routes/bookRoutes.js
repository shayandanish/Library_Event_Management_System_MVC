const express = require("express");
const router = express.Router();
const bookController = require("../controllers/bookController");

/**
 * Books Routes
 */

// List all books
router.get("/", bookController.listBooks);

// Show a dedicated page with only the add book form
router.get("/add", (req, res) => {
  // Render a template containing only the add book form.  Passing query
  // parameters allows any flash messages to be displayed on this page.
  res.render("addBook", { query: req.query });
});

// Add a new book
router.post("/add", bookController.addBook);

// Update an existing book
router.post("/update/:id", bookController.updateBook);

// Delete a book
router.post("/delete/:id", bookController.deleteBook);

// Lookup book details (by Mongo _id or custom bookID like AIPSLIB000123) → JSON
router.get("/lookup/:id", bookController.lookupBook);

// Issue a book
router.post("/issue/:id", bookController.issueBook);

// Return a book
router.post("/return/:id", bookController.returnBook);

module.exports = router;
