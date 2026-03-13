import { useMemo } from "react";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";
import remarkAdmonitions from "../remarkAdmonitions";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeImages from "../mdx/rehypeImagesPlugin";
import rehypeStringify from "rehype-stringify";

async function fetchEditorStatus() {
  const url =
    "https://raw.githubusercontent.com/rotorflight/rotorflight-docs/main/config/docEditorStatus.json";

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;

  return await res.json();
}

// ---------------------------------------------------------
// Normalize MDX import paths (./, ../, /, bare paths)
// ---------------------------------------------------------
function resolveImportPath(currentDocPath, relPath) {
  //console.log("🔧 [resolveImportPath] START");
  //console.log("   currentDocPath:", currentDocPath);
  //console.log("   relPath:", relPath);

  const baseDir = currentDocPath.replace(/[^/]+$/, "");
  //console.log("   baseDir:", baseDir);

  if (relPath.startsWith("/")) {
    const cleaned = relPath.replace(/^\//, "");
    //console.log("   → absolute path:", cleaned);
    return cleaned;
  }

  const combined = `${baseDir}${relPath}`;
  //console.log("   combined:", combined);

  const parts = combined.split("/").reduce((acc, part) => {
    if (part === "" || part === ".") {
      //console.log("   • skip part:", part);
      return acc;
    }
    if (part === "..") {
      //console.log("   • go up one directory");
      acc.pop();
      return acc;
    }
    //console.log("   • push part:", part);
    acc.push(part);
    return acc;
  }, []);

  const normalized = parts.join("/");
  //  console.log("   normalized:", normalized);
  //console.log("🔧 [resolveImportPath] END\n");

  return normalized;
}

// ---------------------------------------------------------
// Extract MDX import → backend URL map
// ---------------------------------------------------------
function extractImportMap(content, currentDocPath) {
  //  nsole.log("🔍 [extractImportMap] Extracting imports for:", currentDocPath);

  const importRegex =
    /import\s+([A-Za-z0-9_$]+)\s+from\s+["']([^"']+\.(?:png|jpe?g|gif|svg|mp4|webm))["']/g;

  const map = {};
  let match;

  const isLocal = currentDocPath.startsWith("local-workspace/");

  while ((match = importRegex.exec(content))) {
    const varName = match[1];
    const relPath = match[2];

    //console.log("   📥 MDX IMPORT FOUND:", varName, relPath);

    const normalized = resolveImportPath(currentDocPath, relPath);

    const clean = normalized
      .replace(/^local-workspace\//, "")
      .replace(/^local\//, "");

    const url = isLocal
      ? `/api/images/local?path=${clean}`
      : `/api/images?path=${normalized}`;

    //console.log("      resolved URL:", url);

    map[varName] = url;
  }

  //  console.log("🔍 [extractImportMap] Final import map:", map, "\n");
  return map;
}

// ---------------------------------------------------------
// Rewrite JSX-style <img src={var}> and <video src={var}>
// BEFORE unified()
// ---------------------------------------------------------
function rewriteJSXInRawMDX(raw, importMap) {
  //console.log("🔧 [rewriteJSXInRawMDX] START");

  let rewritten = raw;
  let rewriteCount = 0;

  for (const [varName, url] of Object.entries(importMap)) {
    // ⭐ Match both <img> and <video> tags
    const regex = new RegExp(`<(img|video)[^>]*src=\\{${varName}\\}`, "g");

    //console.log(`   Checking for <img|video src={${varName}}> → ${url}`);

    rewritten = rewritten.replace(regex, (match) => {
      //console.log(
      //   `   🔄 Rewriting src={${varName}} → src="http://localhost:4000${url}"`,
      // );
      rewriteCount++;
      return match.replace(
        `src={${varName}}`,
        `src="http://localhost:4000${url}"`,
      );
    });
  }

  //console.log(`🔧 [rewriteJSXInRawMDX] Total rewrites: ${rewriteCount}\n`);
  return rewritten;
}

// ---------------------------------------------------------
// Preview Component
// ---------------------------------------------------------
export default function Preview({ content, currentDocPath }) {
  const html = useMemo(() => {
    if (!content) return "";
    // If the selected file is an image, render it directly
    if (/\.(png|jpe?g|gif|svg|webp)$/i.test(currentDocPath)) {
      const clean = currentDocPath
        .replace(/^local-workspace\//, "")
        .replace(/^local\//, "");

      const src = currentDocPath.startsWith("local-workspace/")
        ? `/api/images/local?path=${clean}`
        : `/api/images?path=${currentDocPath}`;

      return `<img src="${src}" style="max-width:100%; height:auto;" />`;
    }

    //console.log("🟦 [Preview] Rendering:", currentDocPath);

    try {
      const importMap = extractImportMap(content, currentDocPath);
      const rewrittenContent = rewriteJSXInRawMDX(content, importMap);

      const file = unified()
        .use(remarkParse)
        .use(remarkGfm)
        .use(remarkDirective)
        .use(remarkAdmonitions)
        .use(remarkRehype, { allowDangerousHtml: true })
        .use(rehypeImages, currentDocPath)
        .use(rehypeRaw)
        .use(rehypeImages, currentDocPath)
        .use(rehypeStringify)
        .processSync(rewrittenContent);

      const finalHTML = String(file);

      //console.log("🟩 [Preview] Final HTML length:", finalHTML.length, "\n");

      return finalHTML;
    } catch (err) {
      console.error("❌ [Preview] Markdown render error:", err);
      return content;
    }
  }, [content, currentDocPath]);

  return (
    <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
  );
}
