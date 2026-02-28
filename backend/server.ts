// Load env FIRST
import dotenv from "dotenv";
dotenv.config();

// THEN import everything else
import express from "express";
import cors from "cors";
import authRoutes from "./authRoutes";
import docsRoutes from "./docsRoutes";
import imagesRoutes from "./imagesRoutes";

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

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
