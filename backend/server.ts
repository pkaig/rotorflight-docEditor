// Load env FIRST
import dotenv from "dotenv";
dotenv.config();

// THEN import everything else
import express from "express";
import cors from "cors";
import session from "express-session";
import authRoutes from "./routes/authRoutes";
import docsRoutes from "./routes/docsRoutes";
import resetMirrorRoutes from "./routes/resetMirror";
import versionRouter from "./routes/version";
import git from "./routes/gitRoutes";

const app = express();
const PORT = process.env.PORT || 4000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:5173";

if (!process.env.SESSION_SECRET) {
  console.warn(
    "⚠️  SESSION_SECRET is not set — using an insecure development fallback. " +
      "Set a real random value in .env before this is used by anyone but you.",
  );
}

// A wildcard origin can't be combined with credentialed (cookie-bearing)
// requests — CORS must name the real frontend origin for sessions to work.
app.use(
  cors({
    origin: FRONTEND_ORIGIN,
    credentials: true,
  }),
);
app.use(express.json());

// Establishes who's making each request. Every route that touches a user's
// GitHub token or workspace derives identity from req.session.login, never
// from a client-supplied login query param/body field — otherwise anyone
// who knew (or guessed) another user's GitHub username could act as them.
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-only-insecure-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 8 * 60 * 60 * 1000, // 8h, matches the device-flow token's own fallback expiry
    },
  }),
);

// Mount GitHub OAuth + Docs API
app.use("/api/auth", authRoutes);
app.use("/api/docs", docsRoutes);

// Mirror Reset API
app.use("/api/reset-mirror", resetMirrorRoutes);

// Version Gate (must be BEFORE listen)
app.use("/api", versionRouter);

// Git PR + Commit Routes (must be BEFORE listen)
app.use("/api/git", git);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Start server LAST
app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
