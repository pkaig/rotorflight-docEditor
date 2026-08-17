/* backend/scanImages.ts
 *
 * Description of responsibility:
 *   Scans a doc's raw source text for every image it references — MDX
 *   `import x from "./foo.png"` statements, Markdown `![]()` syntax, and
 *   raw `<img src="...">` tags — and resolves each to a path relative
 *   to the doc's own folder.
 *
 * Info:
 *   Regex-based rather than a real MDX/Markdown parse, since the goal
 *   is just "which image files does this doc touch", not a full AST.
 */
console.log("scanImages module loaded");
import path from "path";

export function scanImages(content: string, docPath: string) {
  //console.log("Scanning for images in:", docPath);
  const images = new Set<string>();

  const importRegex =
    /import\s+([A-Za-z0-9_$]+)\s+from\s+["']([^"']+\.(?:png|jpe?g|gif|svg))["']/g;

  const markdownImageRegex = /!\[[^\]]*]\(([^)]+\.(?:png|jpe?g|gif|svg))\)/g;

  const htmlImageRegex =
    /<img[^>]+src=["']([^"']+\.(?:png|jpe?g|gif|svg))["']/g;

  const resolve = (imgPath: string) => {
    const baseDir = path.dirname(docPath);
    return path.join(baseDir, imgPath).replace(/\\/g, "/");
  };

  let match;
  //console.log("Starting image scan...");

  // MDX imports
  while ((match = importRegex.exec(content))) {
    const relPath = match[2];
    console.log(" 📥 IMPORT REL PATH:", relPath);
    images.add(resolve(relPath));
  }

  // Markdown images
  while ((match = markdownImageRegex.exec(content))) {
    images.add(resolve(match[1]));
    //console.log(" 📸 MARKDOWN IMAGE MATCH:", match);
  }

  // HTML <img> tags
  while ((match = htmlImageRegex.exec(content))) {
    images.add(resolve(match[1]));
    //console.log(" 🖼️ HTML IMAGE MATCH:", match);
  }

  //console.log("IMAGES FOUND:", [...images]);
  return [...images];
}
