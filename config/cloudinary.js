const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const multer = require("multer");

// Configure cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Configure storage for different media types
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    // Determine folder and resource type based on file type
    let folder = "library_posts";
    let resourceType = "auto";
    let allowedFormats = [];

    if (file.mimetype.startsWith("image/")) {
      folder = "library_posts/images";
      resourceType = "image";
      allowedFormats = ["jpg", "jpeg", "png", "gif", "webp"];
    } else if (file.mimetype.startsWith("video/")) {
      folder = "library_posts/videos";
      resourceType = "video";
      allowedFormats = ["mp4", "mov", "avi", "wmv", "flv", "mkv"];
    } else if (file.mimetype.startsWith("audio/")) {
      folder = "library_posts/audio";
      resourceType = "video"; // Cloudinary uses 'video' for audio files
      allowedFormats = ["mp3", "wav", "ogg", "m4a", "flac"];
    } else if (file.mimetype === "application/pdf") {
      folder = "library_posts/documents";
      resourceType = "image"; // PDFs are stored as images in Cloudinary
      allowedFormats = ["pdf"];
    }

    return {
      folder: folder,
      resource_type: resourceType,
      allowed_formats: allowedFormats,
      transformation: file.mimetype.startsWith("image/")
        ? [{ width: 1000, height: 1000, crop: "limit", quality: "auto" }]
        : undefined,
    };
  },
});

// File filter to validate file types
const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = [
    // Images
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/gif",
    "image/webp",
    // Videos
    "video/mp4",
    "video/quicktime",
    "video/x-msvideo",
    "video/x-ms-wmv",
    "video/x-flv",
    "video/x-matroska",
    // Audio
    "audio/mpeg",
    "audio/wav",
    "audio/ogg",
    "audio/mp4",
    "audio/flac",
    // PDF
    "application/pdf",
  ];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        "Invalid file type. Only images, videos, audio, and PDF files are allowed.",
      ),
      false,
    );
  }
};

// Create multer upload instance
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
});

module.exports = { cloudinary, upload };
