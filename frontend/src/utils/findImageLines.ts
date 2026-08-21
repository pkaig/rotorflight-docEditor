// Scans raw Markdown/MDX source for lines that reference an image —
// either Markdown syntax (![alt](path)) or a JSX/HTML <img> tag — and
// returns their 1-indexed line numbers. Used to anchor the editor/preview
// scroll sync to actual image positions rather than treating every source
// line as if it took the same vertical space in the rendered preview.
const MARKDOWN_IMAGE_RE = /!\[[^\]]*\]\([^)]*\)/;
const JSX_IMAGE_RE = /<img[\s>]/i;

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
