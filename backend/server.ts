import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import authRoutes from "./authRoutes";
import docsRoutes from "./docsRoutes";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Mount GitHub OAuth + Docs API
app.use("/api/auth", authRoutes);
app.use("/api/docs", docsRoutes);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
