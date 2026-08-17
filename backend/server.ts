/* backend/server.ts
 *
 * Description of responsibility:
 *   The Express app's entry point: wires up CORS, JSON parsing, session
 *   middleware, and mounts every route module
 *   (auth/docs/reset-mirror/version/git) before starting the listener. In
 *   production, also serves the frontend's built static files and falls
 *   back to index.html for any non-API route, so the whole app ships as
 *   one process on one port.
 *
 * Info:
 *   dotenv.config() runs before any other import specifically so every
 *   subsequently-imported module (config/github.ts in particular) sees
 *   fully-populated process.env values at module-load time, not just
 *   inside request handlers. CORS is locked to a single configured
 *   FRONTEND_ORIGIN with credentials:true — a wildcard origin can't be
 *   combined with cookie-bearing requests, so this is what makes
 *   session auth work at all. In production this ends up being
 *   same-origin anyway (the frontend is served by this same process), so
 *   CORS is a defensive no-op for the app's own traffic and only matters
 *   for FRONTEND_ORIGIN being set correctly, not for the app to work.
 */

// Load env FIRST
import dotenv from "dotenv";
dotenv.config();

// THEN import everything else
import express from "express";
import cors from "cors";
import session from "express-session";
import path from "path";
import fs from "fs";
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

// Serve the built frontend in production — dev mode keeps using Vite's own
// dev server (localhost:5173) with its /api proxy, unaffected by this.
// process.cwd() rather than __dirname so this resolves the same running
// from source or from compiled dist/server.js, matching every other
// file-storage path in this app (see authRoutes.ts's TOKENS_DIR).
if (process.env.NODE_ENV === "production") {
  const FRONTEND_DIST = path.join(process.cwd(), "..", "frontend", "dist");

  if (fs.existsSync(path.join(FRONTEND_DIST, "index.html"))) {
    app.use(express.static(FRONTEND_DIST));

    // Any non-API route is a client-side (React Router-less, but still
    // client-rendered) path — hand back index.html and let the frontend
    // itself decide what to render, rather than a 404. Checked manually
    // instead of a "*" wildcard route: Express 5's path-to-regexp no
    // longer accepts a bare unnamed wildcard there.
    app.use((req, res, next) => {
      if (req.path.startsWith("/api/")) return next();
      res.sendFile(path.join(FRONTEND_DIST, "index.html"));
    });
  } else {
    console.warn(
      `⚠️  NODE_ENV=production but no frontend build found at ${FRONTEND_DIST} — ` +
        `run "npm run build" in frontend/ first. Serving API routes only.`,
    );
  }
}

// Start server LAST
app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
