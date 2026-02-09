import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();
console.log("Token loaded:", !!process.env.GITHUB_TOKEN);
const app = express();
const PORT = process.env.PORT || 4000;

// Simple in-memory cache for docs list
let docsCache: any[] | null = null;
let docsCacheTime = 0;
const CACHE_TTL = 1000 * 60 * 5; // 5 minutes

app.use(cors());
app.use(express.json());

// Absolute path to your local clone of rotorflight-docs
const DOCS_ROOT = path.join(__dirname, "rotorflight-docs", "docs");

// GitHub repo root for docs
const ROOT_URL =
  "https://api.github.com/repos/rotorflight/rotorflight-docs/contents/docs";

// Recursively walk GitHub folders (now authenticated)
async function fetchRecursive(url: string, prefix = ""): Promise<any[]> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "RotorflightDocEditor",
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub fetch failed: ${response.status}`);
  }

  const items = await response.json();
  const results: any[] = [];

  for (const item of items) {
    if (item.type === "file" && item.name.endsWith(".mdx")) {
      results.push({
        id: item.name.replace(".mdx", ""),
        title: item.name.replace(".mdx", ""),
        path: item.path,
        download_url: item.download_url,
      });
    }

    if (item.type === "dir") {
      const nested = await fetchRecursive(item.url, `${prefix}${item.name}/`);
      results.push(...nested);
    }
  }

  return results;
}

// API: list all MDX docs recursively
app.get("/api/docs/list", async (_req, res) => {
  try {
    const now = Date.now();
    if (docsCache && now - docsCacheTime < CACHE_TTL) {
      return res.json({ docs: docsCache });
    }
    const docs = await fetchRecursive(ROOT_URL);
    docsCache = docs;
    docsCacheTime = now;
    res.json({ docs });
  } catch (err) {
    console.error("Error fetching docs:", err);
    res.status(500).json({ error: "Failed to fetch docs from GitHub" });
  }
});

// API: serve images from local docs folder

const CACHE_DIR = path.join(__dirname, "cache", "images");

app.get("/api/docs/image", async (req, res) => {
  const relPath = decodeURIComponent(req.query.path as string);
  if (!relPath) return res.status(400).send("Missing 'path'");

  const localPath = path.join(CACHE_DIR, relPath);
  const localDir = path.dirname(localPath);
  const etagPath = localPath + ".etag";

  // Ensure directory exists
  fs.mkdirSync(localDir, { recursive: true });

  const rawUrl = `https://raw.githubusercontent.com/rotorflight/rotorflight-docs/main/${relPath}`;

  // If cached, try conditional request
  let etag: string | null = null;
  if (fs.existsSync(localPath) && fs.existsSync(etagPath)) {
    etag = fs.readFileSync(etagPath, "utf8");
  }

  const headers: any = {
    "User-Agent": "RotorflightDocEditor",
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
  };

  if (etag) {
    headers["If-None-Match"] = etag;
  }

  const response = await fetch(rawUrl, { headers });

  // 304 → serve cached file
  if (response.status === 304 && fs.existsSync(localPath)) {
    return res.sendFile(localPath);
  }

  // 404 → image does not exist on GitHub
  if (response.status === 404) {
    return res.status(404).send("Image not found on GitHub");
  }

  // 200 → new or changed file
  if (!response.ok) {
    return res.status(500).send("Error fetching image");
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  // Save file + ETag
  fs.writeFileSync(localPath, buffer);
  const newEtag = response.headers.get("etag");
  if (newEtag) fs.writeFileSync(etagPath, newEtag);

  res.setHeader(
    "Content-Type",
    response.headers.get("content-type") || "image/png",
  );
  res.send(buffer);
});

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Load raw MDX content
app.get("/api/docs/load", async (req, res) => {
  const filePath = req.query.path as string;
  if (!filePath) {
    return res.status(400).json({ error: "Missing 'path' query parameter" });
  }

  const rawUrl = `https://raw.githubusercontent.com/rotorflight/rotorflight-docs/main/${filePath}`;

  try {
    const response = await fetch(rawUrl, {
      headers: {
        "User-Agent": "RotorflightDocEditor",
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      },
    });

    if (!response.ok) {
      return res.status(500).json({ error: "Failed to fetch MDX content" });
    }

    const text = await response.text();
    res.json({ content: text });
  } catch (err) {
    res.status(500).json({ error: "Error fetching MDX content" });
  }
});

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
