import { useMemo } from "react";
import { unified } from "unified";

import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";
import remarkAdmonitions from "../remarkAdmonitions";
import remarkRehype from "remark-rehype";

import remarkMdx from "remark-mdx";

import rehypeRaw from "rehype-raw";
import rehypeImages from "../mdx/rehypeImagesPlugin";
import rehypeImportedImages from "../mdx/rehypeRewriteImageImports";

import rehypeStringify from "rehype-stringify";

// ---------------------------------------------------------
// Normalize MDX import paths
// ---------------------------------------------------------
function resolveImportPath(currentDocPath, relPath) {
  const baseDir = currentDocPath.replace(/[^/]+$/, "");

  if (relPath.startsWith("/")) {
    return relPath.replace(/^\//, "");
  }

  const combined = `${baseDir}${relPath}`;

  const parts = combined.split("/").reduce((acc, part) => {
    if (part === "" || part === ".") return acc;
    if (part === "..") {
      acc.pop();
      return acc;
    }
    acc.push(part);
    return acc;
  }, []);

  return parts.join("/");
}

// ---------------------------------------------------------
// Extract MDX import → backend URL map
// ---------------------------------------------------------
function extractImportMap(content, currentDocPath) {
  const importRegex =
    /import\s+([A-Za-z0-9_$]+)\s+from\s+["']([^"']+\.(?:png|jpe?g|gif|svg|mp4|webm))["']/g;

  const map = {};
  let match;

  const isLocal = currentDocPath.startsWith("local-workspace/");
  const login =
    typeof window !== "undefined" ? localStorage.getItem("rf_login") : "";

  while ((match = importRegex.exec(content))) {
    const varName = match[1];
    const relPath = match[2];

    const normalised = resolveImportPath(currentDocPath, relPath);

    const clean = normalised
      .replace(/^local-workspace\//, "")
      .replace(/^local\//, "");

    const url = isLocal
      ? `/api/docs/images/local?path=${clean}&login=${login}`
      : `/api/docs/image?path=${normalised}&login=${login}`;

    map[varName] = url;
  }

  return map;
}

// ---------------------------------------------------------
// Rewrite JSX-style <img src={var}>
// ---------------------------------------------------------
function rewriteJSXInRawMDX(raw, importMap) {
  let rewritten = raw;

  for (const [varName, url] of Object.entries(importMap)) {
    const regex = new RegExp(`<(img|video)[^>]*src=\\{${varName}\\}`, "g");

    rewritten = rewritten.replace(regex, (match) => {
      return match.replace(
        `src={${varName}}`,
        `src="http://localhost:4000${url}"`,
      );
    });
  }

  return rewritten;
}

// ---------------------------------------------------------
// Preview Component
// ---------------------------------------------------------
export default function Preview({
  content,
  currentDocPath,
  onError = () => {},
}) {
  const isImage = /\.(png|jpe?g|gif|svg|webp)$/i.test(currentDocPath);

  // IMAGE MODE
  if (isImage) {
    const url = `/api/docs/images/local?path=${encodeURIComponent(
      currentDocPath,
    )}`;
    return (
      <div className="markdown-body">
        <img
          src={url}
          alt={currentDocPath}
          style={{ maxWidth: "100%", height: "auto", display: "block" }}
        />
      </div>
    );
  }

  // MARKDOWN / MDX MODE
  const { html, error } = useMemo(() => {
    if (!content) return { html: "", error: null };

    try {
      const importMap = extractImportMap(content, currentDocPath);
      const rewrittenContent = rewriteJSXInRawMDX(content, importMap);

      const file = unified()
        .use(remarkParse)
        .use(remarkMdx) // ⭐ MDX parsing restored
        .use(remarkGfm)
        .use(remarkDirective)
        .use(remarkAdmonitions)
        .use(remarkRehype, { allowDangerousHtml: true })
        .use(rehypeImportedImages)
        .use(rehypeImages, currentDocPath)
        .use(rehypeRaw)
        .use(rehypeImages, currentDocPath)
        .use(rehypeStringify)
        .processSync(rewrittenContent);

      return { html: String(file), error: null };
    } catch (err) {
      // ⭐ Extract line number if present
      const msg = err.message || String(err);
      const match = msg.match(/line (\d+)/i);
      const line = match ? parseInt(match[1], 10) : null;

      return {
        html: "",
        error: { message: msg, line },
      };
    }
  }, [content, currentDocPath]);

  // ⭐ Notify parent so editor can highlight the line
  if (error && onError) {
    onError(error.line || null);
  } else if (onError) {
    onError(null);
  }

  // ⭐ Render error box instead of HTML
  if (error) {
    return (
      <div
        style={{
          borderLeft: "6px solid #e53935",
          background: "#ffebee",
          padding: "1rem",
          borderRadius: 6,
          margin: "1rem 0",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: "0.5rem" }}>
          Preview Error
        </div>
        <div style={{ fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
          {error.message}
          {error.line && `\n\nPossible issue near line ${error.line}.`}
        </div>
      </div>
    );
  }

  return (
    <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
  );
}
