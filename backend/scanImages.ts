import path from "path";

/**
 * Extracts all image references from a document:
 *  - MDX import statements (import foo from './img/foo.png')
 *  - Markdown inline images (![alt](./img/foo.png))
 *  - Raw HTML <img src="..."> tags
 *
 * Returns absolute doc-relative paths like:
 *   docs/setup/img/flyrotor-1.png
 */
export function scanImages(content, docPath) {
  const images = new Set();

  // 1. MDX import statements
  const importRegex =
    /import\s+[A-Za-z0-9_$]+\s+from\s+['"](.+?\.(png|jpe?g|gif|svg))['"]/g;

  // 2. Markdown inline images
  const markdownImageRegex = /!\[[^\]]*]\((.+?\.(png|jpe?g|gif|svg))\)/g;

  // 3. Raw HTML <img src="...">
  const htmlImageRegex = /<img[^>]+src=["'](.+?\.(png|jpe?g|gif|svg))["']/g;

  // Helper to resolve relative paths
  const resolve = (imgPath) => {
    const baseDir = path.dirname(docPath);
    return path.join(baseDir, imgPath).replace(/\\/g, "/"); // normalize for Windows
  };

  let match;

  // MDX imports
  while ((match = importRegex.exec(content))) {
    images.add(resolve(match[1]));
  }

  // Markdown images
  while ((match = markdownImageRegex.exec(content))) {
    images.add(resolve(match[1]));
  }

  // HTML <img> tags
  while ((match = htmlImageRegex.exec(content))) {
    images.add(resolve(match[1]));
  }

  return [...images];
}
