/* frontend/src/utils/insertImageReference.ts
 *
 * Description of responsibility:
 *   Builds the text to insert into a doc's source for an image
 *   reference — either a newly-uploaded file or an existing one picked
 *   from elsewhere in the workspace, the caller already having resolved
 *   relPath either way — and applies it at the right spot(s): a plain
 *   Markdown line for a .md file, or an import + <img> pair for .mdx
 *   (matching the pattern the "new page" template's own worked example
 *   already uses, per the user's preference for MDX docs to use real
 *   imports rather than a bare Markdown image tag).
 */

// Converts a filename into a valid, readable JS identifier for the
// import statement — "flash-driver.png" -> "flashDriver" — and avoids
// colliding with any import already in the doc by appending a number.
export function makeImportVarName(existingContent: string, filename: string): string {
  const base = filename
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, c: string) => c.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, "");
  const safeBase = /^[a-zA-Z_]/.test(base) ? base : `img${base}`;
  const camel = safeBase.charAt(0).toLowerCase() + safeBase.slice(1) || "image";

  const usedNames = new Set(
    Array.from(existingContent.matchAll(/^import\s+(\w+)\s+from/gm)).map(
      (m) => m[1],
    ),
  );

  if (!usedNames.has(camel)) return camel;
  let i = 2;
  while (usedNames.has(`${camel}${i}`)) i++;
  return `${camel}${i}`;
}

export function insertImageReference(
  original: string,
  cursorOffset: number,
  isMdx: boolean,
  relPath: string,
): string {
  const filename = relPath.split("/").pop() || relPath;

  if (!isMdx) {
    return (
      original.slice(0, cursorOffset) +
      `\n![](${relPath})\n` +
      original.slice(cursorOffset)
    );
  }

  const varName = makeImportVarName(original, filename);
  const frontmatterMatch = original.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  const importInsertOffset = frontmatterMatch ? frontmatterMatch[0].length : 0;
  const importLine = `import ${varName} from "${relPath}";\n`;
  const jsxTag = `\n<img src={${varName}} style={{ maxWidth: '100%' }} />\n`;

  if (cursorOffset >= importInsertOffset) {
    // Apply the later insertion (the <img> tag, at the cursor) first so
    // its offset isn't shifted by the import line landing above it.
    const withTag =
      original.slice(0, cursorOffset) + jsxTag + original.slice(cursorOffset);
    return (
      withTag.slice(0, importInsertOffset) +
      importLine +
      withTag.slice(importInsertOffset)
    );
  }

  // Rare: cursor sits at/above the frontmatter block itself.
  return (
    original.slice(0, importInsertOffset) +
    importLine +
    jsxTag +
    original.slice(importInsertOffset)
  );
}
