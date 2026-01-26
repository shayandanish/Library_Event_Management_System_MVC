// routes/userRoutes.js
const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");

// Authorization helper for routes that should only be accessible to
// librarians.  We read the `isAdmin` cookie written by the admin login
// route.  Non‑admins are redirected back to the login page.
const cookie = require("cookie");
function requireAdmin(req, res, next) {
  const cookies = cookie.parse(req.headers.cookie || "");
  if (cookies.isAdmin === "1") {
    return next();
  }
  return res.redirect("/admin/login");
}

// Add Member form + create
router.get("/add", requireAdmin, userController.renderAddForm);
router.get("/list", requireAdmin, userController.renderList);
router.post("/add", requireAdmin, userController.createMember);

// List for dropdown/search
router.get("/", userController.listUsers);

module.exports = router;
