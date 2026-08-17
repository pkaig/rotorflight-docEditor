import express from "express";
import fs from "fs";
import path from "path";
import mime from "mime-types";
import fetch from "node-fetch";
import multer from "multer";
import { isSafePathSegment, isSafeRelativePath } from "../safePath";

const router = express.Router();
const upload = multer();

// GitHub raw base for your repo
const GITHUB_RAW =
  "https://raw.githubusercontent.com/rotorflight/rotorflight-docs/main/";

// Local cache root
const CACHE_ROOT = path.join(process.cwd(), "cache", "images");

// ---------------------------------------------
// GET /api/images?path=docs/.../img/foo.png
// ---------------------------------------------
router.get("/", async (req, res) => {
  const relPath = req.query.path as string;

  if (!relPath) {
    return res.status(400).send("Missing ?path=");
  }
  if (!isSafeRelativePath(relPath)) {
    return res.status(400).send("Invalid path");
  }

  const localPath = path.join(CACHE_ROOT, relPath);

  // 1. Serve from cache
  if (fs.existsSync(localPath)) {
    res.set(
      "Content-Type",
      mime.lookup(localPath) || "application/octet-stream",
    );
    return res.sendFile(localPath);
  }

  // 2. Fetch from GitHub
  const githubUrl = GITHUB_RAW + relPath;
  const response = await fetch(githubUrl);

  if (!response.ok) {
    return res.status(404).send("Image not found");
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  // 3. Save to cache
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  fs.writeFileSync(localPath, buffer);

  // 4. Serve
  res.set("Content-Type", response.headers.get("content-type") || "image/png");
  res.send(buffer);
});

// ---------------------------------------------
// POST /api/images/upload
// body: { folder: "docs/examples/img" }
// file: multipart/form-data
// ---------------------------------------------
router.post("/upload", upload.single("file"), (req, res) => {
  const { folder } = req.body;
  const file = req.file;

  if (!folder || !file) {
    return res.status(400).json({ error: "Missing folder or file" });
  }
  if (!isSafeRelativePath(folder) || !isSafePathSegment(file.originalname)) {
    return res.status(400).json({ error: "Invalid folder or file name" });
  }

  const dest = path.join(CACHE_ROOT, folder, file.originalname);

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, file.buffer);

  res.json({
    ok: true,
    path: `${folder}/${file.originalname}`,
  });
});

export default router;
