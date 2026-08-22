// Scans raw Markdown/MDX source for lines that reference an image —
// either Markdown syntax (![alt](path)) or a JSX/HTML <img> tag — and
// returns their 1-indexed line numbers. Used to anchor the editor/preview
// scroll sync to actual image positions rather than treating every source
// line as if it took the same vertical space in the rendered preview.
const MARKDOWN_IMAGE_RE = /!\[[^\]]*\]\(([^)]*)\)/;
const JSX_IMAGE_RE = /<img[\s>]/i;
const JSX_IMG_SRC_VAR_RE = /<img[^>]*\ssrc=\{(\w+)\}/;

export function findImageLines(content: string): number[] {
  const lines = content.split("\n");
  const result: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (MARKDOWN_IMAGE_RE.test(lines[i]) || JSX_IMAGE_RE.test(lines[i])) {
      result.push(i + 1);
    }
  }

  return result;
}

// Pulls the path out of a Markdown-syntax image line specifically (not
// JSX <img>, whose src is often a JS variable rather than a literal
// path — resolving that would mean also parsing the doc's own import
// statements, out of scope for now). Returns null for a line that isn't
// a Markdown image at all, or whose src is JSX. The Move/Update image
// toolbar actions only operate on lines this resolves, by design —
// Markdown image syntax works identically in both .md and .mdx, so
// steering inserts toward it keeps those actions file-type-agnostic.
export function extractMarkdownImagePath(line: string): string | null {
  const match = line.match(MARKDOWN_IMAGE_RE);
  return match ? match[1].trim() : null;
}

// Removes an image reference at the given 1-indexed line — a plain
// Markdown line just gets deleted; a JSX <img src={varName} /> line also
// deletes its matching `import varName from "...";` line elsewhere in
// the doc (importInsertOffset in insertImageReference.ts always puts
// that import above the tag, so removing the tag first never shifts the
// import's own line index before it's found). Only removes the doc's
// *reference* to the image — the actual file stays in the workspace.
export function removeImageReference(content: string, lineNumber: number): string {
  const lines = content.split("\n");
  const idx = lineNumber - 1;
  if (idx < 0 || idx >= lines.length) return content;

  const lineText = lines[idx];

  if (extractMarkdownImagePath(lineText)) {
    lines.splice(idx, 1);
    return lines.join("\n");
  }

  const jsxMatch = lineText.match(JSX_IMG_SRC_VAR_RE);
  if (jsxMatch) {
    const varName = jsxMatch[1];
    lines.splice(idx, 1);

    const importRe = new RegExp(
      `^import\\s+${varName}\\s+from\\s+["'][^"']*["'];?\\s*$`,
    );
    const importIdx = lines.findIndex((l) => importRe.test(l));
    if (importIdx !== -1) lines.splice(importIdx, 1);

    return lines.join("\n");
  }

  return content;
}
