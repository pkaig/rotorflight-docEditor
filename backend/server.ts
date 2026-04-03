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

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Mount GitHub OAuth + Docs API
app.use("/api/auth", authRoutes);
app.use("/api/docs", docsRoutes);

// Mount Images API (cache + proxy)
app.use("/api/images", imagesRoutes);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Mount Mirror Reset API
app.use("/api/reset-mirror", resetMirrorRoutes);

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});

// Version
app.use("/api", versionRouter);
