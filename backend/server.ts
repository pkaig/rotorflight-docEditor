// Load env FIRST
import dotenv from "dotenv";
dotenv.config();

// THEN import everything else
import express from "express";
import cors from "cors";
import authRoutes from "./routes/authRoutes";
import docsRoutes from "./routes/docsRoutes";
import imagesRoutes from "./routes/imagesRoutes";
import resetMirrorRoutes from "./routes/resetMirror";
import versionRouter from "./routes/version";
import git from "./routes/gitRoutes";

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Mount GitHub OAuth + Docs API
app.use("/api/auth", authRoutes);
app.use("/api/docs", docsRoutes);

// Mount Images API (cache + proxy)
app.use("/api/images", imagesRoutes);

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
