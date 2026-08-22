/* frontend/src/utils/tables.ts
 *
 * Description of responsibility:
 *   Parses and builds GFM Markdown tables — the Table toolbar's
 *   Modify/Remove need to find a clicked table's full extent in the raw
 *   source (not just its opening line), and Insert/Modify both need to
 *   serialize a table back out.
 *
 * Info:
 *   Deliberately doesn't handle a literal "|" inside a cell (would need
 *   escaping as "\|") or per-column alignment — kept to the same scope
 *   as the admonitions entry form (structure + content, no per-field
 *   styling options).
 */
export interface TableBlock {
  startLine: number; // 1-indexed line of the header row
  endLine: number; // 1-indexed line of the last body row (inclusive)
  headers: string[];
  rows: string[][];
}

function parseRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
  return trimmed.split("|").map((c) => c.trim());
}

const SEPARATOR_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

// Finds the full extent of the table starting at startLine (the line
// data-source-line pointed at on the rendered <table> — see
// rehypeSourceLines.ts). Requires the conventional leading/trailing "|"
// style — the same style buildMarkdownTable below always produces, so
// anything this toolbar itself inserted is always parseable again.
export function findTableBlock(
  content: string,
  startLine: number,
): TableBlock | null {
  const lines = content.split("\n");
  const headerLine = lines[startLine - 1];
  if (!headerLine || !headerLine.trim().startsWith("|")) return null;

  const sepLine = lines[startLine];
  if (!sepLine || !SEPARATOR_RE.test(sepLine)) return null;

  const headers = parseRow(headerLine);
  const rows: string[][] = [];
  let i = startLine + 1; // 0-indexed, first body row
  while (i < lines.length && lines[i].trim().startsWith("|")) {
    rows.push(parseRow(lines[i]));
    i++;
  }

  return { startLine, endLine: i, headers, rows };
}

export function buildMarkdownTable(
  headers: string[],
  rows: string[][],
): string {
  const headerLine = `| ${headers.join(" | ")} |`;
  const sepLine = `| ${headers.map(() => "---").join(" | ")} |`;
  const rowLines = rows.map((r) => `| ${r.join(" | ")} |`);
  return [headerLine, sepLine, ...rowLines].join("\n");
}
