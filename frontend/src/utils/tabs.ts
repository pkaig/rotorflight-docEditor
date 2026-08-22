/* frontend/src/utils/tabs.ts
 *
 * Description of responsibility:
 *   Parses and builds Docusaurus <Tabs>/<TabItem> JSX blocks — the Tabs
 *   toolbar's Modify/Remove need to find a clicked block's full extent
 *   in the raw source, and Insert/Modify both need to serialize one
 *   back out, including the @theme/Tabs imports it needs to actually
 *   render on the real site (this app's own preview sandbox injects
 *   Tabs/TabItem as globals regardless — see Preview.tsx and
 *   remarkStripImports.ts — but the published doc still needs them).
 *
 * Info:
 *   Only parses <TabItem value="..." label="...">...</TabItem> written
 *   exactly the way buildTabsBlock below produces it — same "only
 *   parses what this toolbar itself generates" simplification as
 *   admonitions.ts/tables.ts.
 */
export interface TabItemData {
  value: string;
  label: string;
  content: string;
}

export interface TabsBlock {
  startLine: number; // 1-indexed line of "<Tabs>"
  endLine: number; // 1-indexed line of "</Tabs>"
  tabs: TabItemData[];
}

const TAB_ITEM_RE =
  /<TabItem\s+value="([^"]*)"\s+label="([^"]*)"[^>]*>\n?([\s\S]*?)<\/TabItem>/g;

export function findTabsBlock(
  content: string,
  startLine: number,
): TabsBlock | null {
  const lines = content.split("\n");
  const openLine = lines[startLine - 1] || "";
  if (!/^\s*<Tabs\b/.test(openLine)) return null;

  let endIdx = -1; // 0-indexed
  for (let i = startLine - 1; i < lines.length; i++) {
    if (lines[i].trim() === "</Tabs>") {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) return null;

  const blockText = lines.slice(startLine - 1, endIdx + 1).join("\n");
  const tabs: TabItemData[] = [];
  let match: RegExpExecArray | null;
  TAB_ITEM_RE.lastIndex = 0;
  while ((match = TAB_ITEM_RE.exec(blockText))) {
    tabs.push({ value: match[1], label: match[2], content: match[3].trim() });
  }

  return { startLine, endLine: endIdx + 1, tabs };
}

export function buildTabsBlock(tabs: TabItemData[]): string {
  const items = tabs
    .map((t) => {
      const indentedContent = t.content
        .split("\n")
        .map((l) => (l ? `    ${l}` : l))
        .join("\n");
      return `  <TabItem value="${t.value}" label="${t.label}">\n${indentedContent}\n  </TabItem>`;
    })
    .join("\n");
  return `<Tabs>\n${items}\n</Tabs>`;
}

// Detected by module path via regex, not exact string match — real docs
// already carrying these imports don't necessarily match this file's
// own spacing/quote conventions (e.g. "import Tabs      from ..." for
// column-aligned imports), and an exact-string check missed those,
// adding a second, duplicate import that broke compilation with
// "Identifier 'Tabs' has already been declared".
const TABS_IMPORT_CHECKS: { re: RegExp; line: string }[] = [
  {
    re: /^\s*import\s+React\s+from\s+['"]react['"]\s*;?\s*$/m,
    line: "import React from 'react';",
  },
  {
    re: /^\s*import\s+Tabs\s+from\s+['"]@theme\/Tabs['"]\s*;?\s*$/m,
    line: "import Tabs from '@theme/Tabs';",
  },
  {
    re: /^\s*import\s+TabItem\s+from\s+['"]@theme\/TabItem['"]\s*;?\s*$/m,
    line: "import TabItem from '@theme/TabItem';",
  },
];

// Idempotent — a doc can hold several <Tabs> blocks that all share one
// set of imports, so Insert only adds whichever of the three (if any)
// the doc doesn't already have.
export function ensureTabsImports(content: string): string {
  const missing = TABS_IMPORT_CHECKS.filter((c) => !c.re.test(content)).map(
    (c) => c.line,
  );
  if (missing.length === 0) return content;

  const frontmatterMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  const insertOffset = frontmatterMatch ? frontmatterMatch[0].length : 0;
  const importBlock = missing.join("\n") + "\n";
  return (
    content.slice(0, insertOffset) + importBlock + content.slice(insertOffset)
  );
}
