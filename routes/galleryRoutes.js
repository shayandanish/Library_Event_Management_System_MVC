// routes/galleryRoutes.js
const express = require("express");
const fs = require("fs");
const path = require("path");

const router = express.Router();
const GALLERY_DIR = path.join(__dirname, "..", "public", "images", "gallery");

// GET /gallery
router.get("/", async (_req, res) => {
  try {
    await fs.promises.mkdir(GALLERY_DIR, { recursive: true });
    const files = await fs.promises.readdir(GALLERY_DIR);
    const images = files
      .filter((f) => /\.(png|jpe?g|webp|gif)$/i.test(f))
      .sort();
    return res.render("gallery", { title: "Library Gallery", images });
  } catch (err) {
    console.error("Gallery error:", err);
    return res.status(500).send("Unable to load gallery.");
  }
});

module.exports = router;
