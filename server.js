// server.js
require("dotenv").config();
const express = require("express");
const path = require("path");
const bookRoutes = require("./routes/bookRoutes");
const userRoutes = require("./routes/userRoutes");
const galleryRoutes = require("./routes/galleryRoutes");
const postController = require("./controllers/postController"); // Import controller directly
const { upload } = require("./config/cloudinary"); // Import upload middleware
const connectDB = require("./config/db");

// Import the cookie parser.  We load this near the top because multiple
// routes (including the root page) need to inspect cookies for
// authorization and redirects.  The `cookie` module parses raw cookie
// headers into an object we can easily read.
const cookie = require("cookie");

const app = express();

// Trust the first proxy.  This is required when deploying behind a proxy
// (e.g., load balancer or Heroku) so that secure cookies and protocol
// detection work correctly.  Without this Express may incorrectly treat
// the connection as HTTP even if it arrived via HTTPS.
app.set("trust proxy", 1);

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Serve static files from the `public` directory. This allows images and other assets
// to be referenced directly from templates (e.g. /images/library.png).
app.use(express.static(path.join(__dirname, "public")));

// Connect to database
connectDB();

// Routes
// Root landing page.  If the visitor already has a valid admin cookie we
// redirect them straight to the admin dashboard instead of showing the
// public landing page.  Otherwise render the landing page.
app.get("/", (req, res) => {
  // parse cookies from the request headers (if any).  Use the same
  // `cookie` module imported above for admin routes.
  const cookies = cookie.parse(req.headers.cookie || "");
  if (cookies.isAdmin === "1") {
    return res.redirect("/admin/dashboard");
  }
  return res.render("landing");
});

app.use("/books", bookRoutes);
app.use("/members", userRoutes);
app.use("/gallery", galleryRoutes);

// Public routes for Office Events (no authentication needed)
app.get("/office-events", postController.getAllPosts);
app.get("/api/posts/latest", postController.getLatestPosts);

// ------------------ Admin routes ------------------
// Define a dedicated router for all `/admin` endpoints. Using a nested router
// avoids unexpected collisions with other paths (e.g. books or members) and
// ensures that the `/admin` prefix is applied uniformly to each handler.
const adminRouter = express.Router();

// The `cookie` module was imported at the top of this file so routes
// defined below can parse cookies.  See the import near the top of
// server.js.

// Define fixed administrator credentials.  For better security these can
// optionally be configured via environment variables at runtime.  When the
// environment variables are not set the defaults below are used.  Only a
// user who supplies the correct username/password pair will be allowed to
// access the dashboard.
// Administrator credentials can be specified via environment variables.  Use
// defaults only for development – in production configure real credentials.
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "aips";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "aipslib123";

// GET /admin/login – Render a simple login form for librarians/admins.  This
// uses the `adminLogin.ejs` view from the views folder.  If the user is
// already authenticated via the `isAdmin` cookie then redirect them
// straight to the dashboard to avoid unnecessary re‑login.  Otherwise
// render the login form.
adminRouter.get("/login", (req, res) => {
  // If the request already contains a valid admin cookie, skip the login page
  const cookies = cookie.parse(req.headers.cookie || "");
  if (cookies.isAdmin === "1") {
    return res.redirect("/admin/dashboard");
  }
  res.render("adminLogin");
});

// POST /admin/login – Handle form submissions from the admin login page.
// This route validates the provided username and password against the
// predefined administrator credentials.  On success a secure cookie is
// written so subsequent requests can be identified as authenticated.  On
// failure the form is re‑rendered with an error message.
adminRouter.post("/login", (req, res) => {
  // Extract and trim form data to handle mobile browser whitespace issues
  const name = req.body?.name ? String(req.body.name).trim() : "";
  const password = req.body?.password ? String(req.body.password).trim() : "";

  // Require both fields
  if (!name || !password) {
    return res.status(400).render("adminLogin", {
      error: "Please enter both username and password.",
    });
  }

  // Check credentials (compare trimmed values) - ensure exact match
  const usernameMatch = name === ADMIN_USERNAME;
  const passwordMatch = password === ADMIN_PASSWORD;

  if (usernameMatch && passwordMatch) {
    // Successful login: set a cookie to flag this session as an admin.  The
    // cookie is HTTP‑only to prevent client‑side scripts from accessing it.
    // Use SameSite=Lax so the cookie is sent on top‑level navigations back
    // to this site and set an expiry (maxAge) so it persists across sessions.
    res.cookie("isAdmin", "1", {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000,
      path: "/", // Explicitly set path to ensure cookie is available site-wide
      // Only send the cookie over HTTPS when running in production.  When
      // NODE_ENV is not production (e.g. during development), omit the
      // secure flag so local HTTP works without TLS.
      secure: process.env.NODE_ENV === "production",
    });
    return res.redirect("/admin/dashboard");
  }
  // Invalid credentials: show an error message
  return res.status(401).render("adminLogin", {
    error: "Invalid username or password.",
  });
});

// POST /admin/logout – Clear the admin cookie and redirect to the public landing page.
// Overwrite the existing cookie with an empty value and a zero maxAge to
// immediately expire it.  A POST method is used because deleting a cookie
// is a state‑changing operation.
adminRouter.post("/logout", (req, res) => {
  res.cookie("isAdmin", "", {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 0,
    secure: process.env.NODE_ENV === "production",
  });
  return res.redirect("/");
});

// Middleware to protect admin routes.  Any route defined after this will
// require the `isAdmin` cookie to be present.  If the cookie is missing
// the user is redirected back to the login page.  Only the `/login` routes
// defined above bypass this check.
adminRouter.use((req, res, next) => {
  const cookies = cookie.parse(req.headers.cookie || "");
  // Allow if authenticated
  if (cookies.isAdmin === "1") {
    return next();
  }
  // Otherwise send them to the login page
  return res.redirect("/admin/login");
});

// GET /admin/dashboard – Admin dashboard.  Only accessible once
// authenticated.  Renders the `welcome` view which contains librarian
// functionality.
adminRouter.get("/dashboard", (req, res) => {
  res.render("welcome", { query: req.query });
});

// ------------------ Post Management Routes (Admin Only) ------------------
// These routes are nested under /admin and are protected by the middleware above

// Create Post
adminRouter.get("/create-post", postController.renderCreatePost);
adminRouter.post(
  "/create-post",
  upload.single("media"),
  postController.createPost,
);

// Update Post
adminRouter.get("/update-post", postController.renderUpdatePost);
adminRouter.get("/edit-post/:id", postController.getPostById);
adminRouter.post(
  "/update-post/:id",
  upload.single("media"),
  postController.updatePost,
);

// Delete Post
adminRouter.get("/delete-post", postController.renderDeletePost);
adminRouter.post("/delete-post/:id", postController.deletePost);

// Mount the admin router at the `/admin` prefix.  This ensures all routes
// defined above respond to paths such as `/admin/login` and `/admin/dashboard`.
app.use("/admin", adminRouter);

// Optional: basic health check
app.get("/health", (_req, res) => res.send("ok"));

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send("Something went wrong.");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 http://localhost:${PORT}`));
