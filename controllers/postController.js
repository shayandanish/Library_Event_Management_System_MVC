const Post = require("../models/Post");
const { cloudinary } = require("../config/cloudinary");

// Helper function to determine media type
const getMediaType = (file) => {
  if (!file) return null;
  const mimetype = file.mimetype || "";
  const originalname = file.originalname || "";
  const extension = originalname.split(".").pop().toLowerCase();

  if (mimetype.startsWith("image/")) return "image";
  if (mimetype.startsWith("video/")) return "video";
  if (mimetype.startsWith("audio/")) return "audio";
  if (mimetype === "application/pdf") return "pdf";

  // Fallback to extensions if mimetype is generic or weird
  const videoExts = ["mp4", "mov", "avi", "wmv", "flv", "mkv", "webm"];
  const audioExts = ["mp3", "wav", "ogg", "m4a", "flac"];
  const imageExts = ["jpg", "jpeg", "png", "gif", "webp"];

  if (videoExts.includes(extension)) return "video";
  if (audioExts.includes(extension)) return "audio";
  if (imageExts.includes(extension)) return "image";
  if (extension === "pdf") return "pdf";

  return null;
};

// Render create post page
exports.renderCreatePost = (req, res) => {
  res.render("admin/createPost", { title: "Create Post" });
};

// Create a new post
exports.createPost = async (req, res) => {
  try {
    const { title, content, author, category } = req.body;

    const postData = {
      title,
      content,
      author: author || "Admin",
      category: category || "General",
    };

    // Handle multiple media uploads from Cloudinary Widget
    if (req.body.mediaData) {
      try {
        const mediaArray = JSON.parse(req.body.mediaData);
        postData.media = mediaArray.map(item => ({
          url: item.url || item.secure_url,
          publicId: item.publicId || item.public_id,
          type: item.type || (item.resource_type === "video" ? "video" : "image"),
          format: item.format,
        }));
      } catch (e) {
        console.error("Error parsing mediaData:", e);
        postData.media = [];
      }
    } else {
      postData.media = [];
    }

    const newPost = new Post(postData);
    await newPost.save();

    res.redirect("/admin/dashboard?success=Post created successfully");
  } catch (error) {
    console.error("Error creating post DETAILED:", error);

    res.redirect(`/admin/create-post?error=Failed to create post: ${encodeURIComponent(error.message)}`);
  }
};

// Render update post page
exports.renderUpdatePost = async (req, res) => {
  try {
    const posts = await Post.find().sort({ createdAt: -1 });
    res.render("admin/updatePost", {
      title: "Update Post",
      posts: posts || [],
      success: req.query.success,
      error: req.query.error,
    });
  } catch (error) {
    console.error("Error fetching posts:", error);
    res.render("admin/updatePost", {
      title: "Update Post",
      posts: [],
      error: "Failed to load posts",
    });
  }
};

// Get single post for editing
exports.getPostById = async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.redirect("/admin/update-post?error=Post not found");
    }
    res.render("admin/editPost", { title: "Edit Post", post });
  } catch (error) {
    console.error("Error fetching post:", error);
    res.redirect("/admin/update-post?error=Failed to load post");
  }
};

// Update post
exports.updatePost = async (req, res) => {
  try {
    const { title, content, author, category } = req.body;
    const post = await Post.findById(req.params.id);

    if (!post) {
      return res.redirect("/admin/update-post?error=Post not found");
    }

    const updateData = {
      title,
      content,
      author,
      category,
      updatedAt: Date.now(),
    };

    // Handle media updates from Cloudinary Widget
    if (req.body.mediaData) {
      try {
        const mediaArray = JSON.parse(req.body.mediaData);
        updateData.media = mediaArray.map(item => ({
          url: item.url || item.secure_url,
          publicId: item.publicId || item.public_id,
          type: item.type || (item.resource_type === "video" ? "video" : "image"),
          format: item.format,
        }));
      } catch (e) {
        console.error("Error parsing mediaData during update:", e);
      }
    }

    await Post.findByIdAndUpdate(req.params.id, updateData, { new: true });
    res.redirect("/admin/update-post?success=Post updated successfully");
  } catch (error) {
    console.error("Error updating post:", error);

    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        if (file.filename) {
          try {
            await cloudinary.uploader.destroy(file.filename, {
              resource_type: file.mimetype.startsWith("video/") || file.mimetype.startsWith("audio/") ? "video" : "image"
            });
          } catch (err) {
            console.error("Error deleting file:", err);
          }
        }
      }
    }

    res.redirect("/admin/update-post?error=Failed to update post");
  }
};

// Render delete post page
exports.renderDeletePost = async (req, res) => {
  try {
    const posts = await Post.find().sort({ createdAt: -1 });
    res.render("admin/deletePost", {
      title: "Delete Post",
      posts: posts || [],
      success: req.query.success,
      error: req.query.error,
    });
  } catch (error) {
    console.error("Error fetching posts:", error);
    res.render("admin/deletePost", {
      title: "Delete Post",
      posts: [],
      error: "Failed to load posts",
    });
  }
};

// Delete post
exports.deletePost = async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);

    if (!post) {
      return res.redirect("/admin/delete-post?error=Post not found");
    }

    // Delete media from cloudinary if exists
    if (post.media && post.media.length > 0) {
      for (const m of post.media) {
        if (m.publicId) {
          try {
            await cloudinary.uploader.destroy(m.publicId, {
              resource_type: m.type === "video" || m.type === "audio" ? "video" : "image",
            });
          } catch (err) {
            console.error("Error deleting media from cloudinary:", err);
          }
        }
      }
    }

    await Post.findByIdAndDelete(req.params.id);
    res.redirect("/admin/delete-post?success=Post deleted successfully");
  } catch (error) {
    console.error("Error deleting post:", error);
    res.redirect("/admin/delete-post?error=Failed to delete post");
  }
};

// Public: Get all posts for Office Events page
exports.getAllPosts = async (req, res) => {
  try {
    const posts = await Post.find().sort({ createdAt: -1 });
    res.render("officeEvents", { title: "Office Events", posts });
  } catch (error) {
    console.error("Error fetching posts:", error);
    res.render("officeEvents", {
      title: "Office Events",
      posts: [],
      error: "Failed to load posts",
    });
  }
};

// API: Get latest posts (for homepage)
exports.getLatestPosts = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 3;
    const posts = await Post.find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .select("title content author category media createdAt");

    res.json({ success: true, posts });
  } catch (error) {
    console.error("Error fetching latest posts:", error);
    res.status(500).json({ success: false, error: "Failed to load posts" });
  }
};
