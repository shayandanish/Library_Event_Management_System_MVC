// routes/postRoutes.js
// This file is now optional since routes are defined in server.js
// You can delete this file or keep it for future reorganization

const express = require("express");
const router = express.Router();
const postController = require("../controllers/postController");

// Public routes only (no authentication needed)
router.get("/office-events", postController.getAllPosts);
router.get("/api/posts/latest", postController.getLatestPosts);

module.exports = router;
