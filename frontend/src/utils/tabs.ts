/* frontend/src/utils/tabs.ts
 *
 * Description of responsibility:
 *   Parses and builds Docusaurus <Tabs>/<TabItem> JSX blocks — the Tabs
 *   toolbar's Modify/Remove need to find a clicked block's full extent
 *   in the raw source, and Insert/Modify both need to serialize one
 *   back out, including the imports it needs to actually render on the
 *   real site (this app's own preview sandbox injects Tabs/TabItem as
 *   globals regardless — see Preview.tsx and remarkStripImports.ts —
 *   but the published doc still needs them). Also owns adding/removing
 *   those imports: Insert calls ensureTabsImports, and the Remove
 *   handler (App.tsx) calls removeTabsImportsIfUnused once the block
 *   itself is gone, so a doc's imports track whether it actually has
 *   any <Tabs> left rather than needing a separate standard to enforce
 *   that after the fact.
 *
 * Info:
 *   Only parses <TabItem value="..." label="...">...</TabItem> written
 *   exactly the way buildTabsBlock below produces it — same "only
 *   parses what this toolbar itself generates" simplification as
 *   admonitions.ts/tables.ts.
 */
import { relativePosixPath } from "./relativePosixPath";
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

// The docs repo keeps a separate tabs.module.css per top-level docs/
// tree rather than one shared file — docs/tabs.module.css,
// versioned_docs/version-2.3.0/tabs.module.css, etc. — so its import
// target is derived from the doc's own path, not hardcoded.
function tabsModuleCssTarget(docRelPath: string): string {
  const versioned = docRelPath.match(/^versioned_docs\/[^/]+/);
  return versioned ? `${versioned[0]}/tabs.module.css` : "docs/tabs.module.css";
}

function tabStylesImportLine(docRelPath: string): string {
  const docFolder = docRelPath.replace(/\/[^/]+$/, "");
  let rel = relativePosixPath(docFolder, tabsModuleCssTarget(docRelPath));
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return `import tabStyles from '${rel}';`;
}

// Detected by module path via regex, not exact string match — real docs
// already carrying these imports don't necessarily match this file's
// own spacing/quote conventions (e.g. "import Tabs      from ..." for
// column-aligned imports), and an exact-string check missed those,
// adding a second, duplicate import that broke compilation with
// "Identifier 'Tabs' has already been declared".
function tabsImportChecks(docRelPath: string): { re: RegExp; line: string }[] {
  return [
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
    {
      re: /^\s*import\s+tabStyles\s+from\s+['"][^'"]*tabs\.module\.css['"]\s*;?\s*$/m,
      line: tabStylesImportLine(docRelPath),
    },
  ];
}

// Idempotent — a doc can hold several <Tabs> blocks that all share one
// set of imports, so Insert only adds whichever of the four (if any)
// the doc doesn't already have. docRelPath is the doc's own workspace-
// relative path (e.g. "docs/testing/foo.mdx"), needed only to compute
// the tabStyles import's relative path.
export function ensureTabsImports(content: string, docRelPath: string): string {
  const missing = tabsImportChecks(docRelPath)
    .filter((c) => !c.re.test(content))
    .map((c) => c.line);
  if (missing.length === 0) return content;

  const frontmatterMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  const insertOffset = frontmatterMatch ? frontmatterMatch[0].length : 0;
  const importBlock = missing.join("\n") + "\n";
  return (
    content.slice(0, insertOffset) + importBlock + content.slice(insertOffset)
  );
}

// Called after a <Tabs> block is removed — strips the four imports back
// out, but only once none are left in the doc at all (a doc can hold
// several <Tabs> blocks sharing one set of imports, so removing one of
// several must leave them alone). docRelPath isn't needed here since
// removal only has to *match* the tabStyles line, not build one.
export function removeTabsImportsIfUnused(content: string): string {
  if (/<Tabs\b/.test(content)) return content;

  const importRes = [
    /^\s*import\s+React\s+from\s+['"]react['"]\s*;?\s*\n?/m,
    /^\s*import\s+Tabs\s+from\s+['"]@theme\/Tabs['"]\s*;?\s*\n?/m,
    /^\s*import\s+TabItem\s+from\s+['"]@theme\/TabItem['"]\s*;?\s*\n?/m,
    /^\s*import\s+tabStyles\s+from\s+['"][^'"]*tabs\.module\.css['"]\s*;?\s*\n?/m,
  ];

  return importRes.reduce((acc, re) => acc.replace(re, ""), content);
}
