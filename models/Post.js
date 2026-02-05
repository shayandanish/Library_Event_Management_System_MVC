const mongoose = require("mongoose");

const postSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
  },
  content: {
    type: String,
    required: true,
  },
  author: {
    type: String,
    default: "Admin",
  },
  media: [{
    url: {
      type: String,
      default: null,
    },
    publicId: {
      type: String,
      default: null,
    },
    type: {
      type: String,
      enum: ["image", "video", "audio", "pdf", null],
      default: null,
    },
    format: {
      type: String,
      default: null,
    },
  }],
  category: {
    type: String,
    default: "General",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Post", postSchema);
