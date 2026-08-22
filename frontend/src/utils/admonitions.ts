/* frontend/src/utils/admonitions.ts
 *
 * Description of responsibility:
 *   Parses and builds the Docusaurus-style `:::type[title]` directive
 *   blocks remarkAdmonitions.ts compiles into rendered admonitions —
 *   the Admonitions toolbar's Modify/Remove need to find a clicked
 *   admonition's full extent in the raw source (not just its opening
 *   line), and Insert/Modify both need to serialize a block back out.
 */
export const ADMONITION_TYPES = [
  "note",
  "tip",
  "info",
  "caution",
  "danger",
] as const;

export type AdmonitionType = (typeof ADMONITION_TYPES)[number];

// Matches App.css's --adm-border values exactly (the border color each
// rendered admonition actually uses, from Docusaurus's own Infima
// theme) — kept as a plain color here since a type-selector chip has no
// document element to hang a CSS custom property off of the way the
// rendered admonition itself does.
export const ADMONITION_COLORS: Record<AdmonitionType, string> = {
  note: "#d4d5d8",
  tip: "#009400",
  info: "#4cb3d4",
  caution: "#e6a700",
  danger: "#e13238",
};

export interface AdmonitionBlock {
  startLine: number; // 1-indexed line of the opening ":::type[title]"
  endLine: number; // 1-indexed line of the closing ":::"
  type: string;
  title: string;
  body: string;
}

const OPEN_RE = /^:::(\w+)(?:\[([^\]]*)\])?\s*$/;

// Finds the full extent of the admonition block that starts at
// startLine (the line data-source-line pointed at — see
// rehypeSourceLines.ts). Doesn't handle a nested directive inside the
// block (its own closing ":::" would be mistaken for the outer one's) —
// real docs essentially never nest admonitions, so this is a deliberate
// simplification rather than a full directive-aware parser.
export function findAdmonitionBlock(
  content: string,
  startLine: number,
): AdmonitionBlock | null {
  const lines = content.split("\n");
  const openLine = lines[startLine - 1] || "";
  const match = openLine.match(OPEN_RE);
  if (!match) return null;

  const type = match[1];
  const title = match[2] || "";

  for (let i = startLine; i < lines.length; i++) {
    if (lines[i].trim() === ":::") {
      const body = lines.slice(startLine, i).join("\n");
      return { startLine, endLine: i + 1, type, title, body };
    }
  }
  return null;
}

export function buildAdmonitionBlock(
  type: string,
  title: string,
  body: string,
): string {
  const header = title ? `:::${type}[${title}]` : `:::${type}`;
  return `${header}\n${body}\n:::`;
}
