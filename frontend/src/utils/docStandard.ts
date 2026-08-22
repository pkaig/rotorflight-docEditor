/* frontend/src/utils/docStandard.ts
 *
 * Description of responsibility:
 *   The one definition of what an MDX doc in this project is expected
 *   to contain — currently the four imports every .mdx file should
 *   carry (React, Tabs, TabItem, the shared tabs.module.css) — plus the
 *   MD -> MDX conversion that applies it. Insert-Tabs (tabs.ts) already
 *   adds its own three of these independently the first time someone
 *   actually inserts a Tabs block; this module is the standard a doc
 *   is brought up to as a whole, in one pass, when it's converted from
 *   Markdown.
 *
 *   Which imports are required can be overridden remotely (docStandard
 *   .json in the docs repo, proxied via /api/doc-standard) without an
 *   app update — see resolveRequiredImportRules. A remote entry that
 *   supplies its own literal import line works immediately even for an
 *   id this app has never seen before, since detecting "already
 *   present" only needs the import's module specifier, not app-side
 *   logic. The one thing that can't come from remote text is a line
 *   whose value depends on *which file* it's going into — tabStyles'
 *   path to tabs.module.css varies by the doc's own folder depth — so
 *   those stay resolved from COMPUTED_RULES, the app's own known
 *   builders, selected by id only.
 *
 * Info:
 *   The docs repo keeps a separate tabs.module.css per top-level docs/
 *   tree rather than one shared file — docs/tabs.module.css,
 *   versioned_docs/version-2.3.0/tabs.module.css, etc. — so the import
 *   target is derived from the doc's own path, not hardcoded, and the
 *   relative path to it is computed fresh per file the same way image
 *   imports already are (see relativePosixPath.ts).
 */
import { relativePosixPath } from "./relativePosixPath";
import { makeImportVarName } from "./insertImageReference";

export interface StandardImportRule {
  id: string;
  detect: RegExp;
  buildLine: (docRelPath: string) => string;
}

function tabsModuleCssTarget(docRelPath: string): string {
  const versioned = docRelPath.match(/^versioned_docs\/[^/]+/);
  return versioned ? `${versioned[0]}/tabs.module.css` : "docs/tabs.module.css";
}

// Ids whose correct import line can't be a fixed string — it depends on
// which file it's being inserted into. Never overridable by a remote
// `line`; only selectable by id.
const COMPUTED_RULES: Record<string, Omit<StandardImportRule, "id">> = {
  tabStyles: {
    detect: /^\s*import\s+tabStyles\s+from\s+['"][^'"]*tabs\.module\.css['"]\s*;?\s*$/m,
    buildLine: (docRelPath) => {
      const docFolder = docRelPath.replace(/\/[^/]+$/, "");
      let rel = relativePosixPath(docFolder, tabsModuleCssTarget(docRelPath));
      if (!rel.startsWith(".")) rel = `./${rel}`;
      return `import tabStyles from '${rel}';`;
    },
  },
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The only shape ever accepted from a remote `line` — a single
// well-formed default-import statement, nothing after it. Anchored
// start-to-end so no amount of trailing/extra content sneaks through
// verbatim into a generated doc.
const IMPORT_LINE_RE = /^import\s+\S+\s+from\s+(['"])([^'"]+)\1;?$/;

// "Already present" is detected by import specifier (the module path),
// not exact line text — real docs don't necessarily match one exact
// spacing/quote convention, the same reasoning every rule here already
// follows (see tabs.ts's own ensureTabsImports for the bug this avoided
// the first time around).
function ruleFromLine(id: string, rawLine: string): StandardImportRule | null {
  const line = rawLine.trim();
  const match = IMPORT_LINE_RE.exec(line);
  if (!match) return null;

  const specifier = match[2];
  const detect = new RegExp(
    `^\\s*import\\s+\\S+\\s+from\\s+['"]${escapeRegExp(specifier)}['"]\\s*;?\\s*$`,
    "m",
  );
  return { id, detect, buildLine: () => line };
}

function computedRule(id: string): StandardImportRule | null {
  const rule = COMPUTED_RULES[id];
  return rule ? { id, ...rule } : null;
}

export const DEFAULT_MDX_IMPORT_RULES: StandardImportRule[] = [
  ruleFromLine("react", "import React from 'react';"),
  ruleFromLine("tabs", "import Tabs from '@theme/Tabs';"),
  ruleFromLine("tabItem", "import TabItem from '@theme/TabItem';"),
  computedRule("tabStyles"),
].filter((r): r is StandardImportRule => !!r);

interface RemoteImportEntry {
  id?: unknown;
  line?: unknown;
}

// Resolves docStandard.json's `mdxRequiredImports` into the rules to
// actually apply, in order. Each entry needs an id; if it also supplies
// a valid `line`, that line is used directly (works even for an id the
// app has never heard of). Otherwise, an id this app already knows how
// to compute (currently just tabStyles) falls back to that. Anything
// else — an unrecognised id with no line, a malformed line, or the
// whole config being unreachable/malformed — is dropped, and if that
// leaves nothing at all, DEFAULT_MDX_IMPORT_RULES is used instead: a
// broken remote config can never mean "no required imports."
export function resolveRequiredImportRules(remote: unknown): StandardImportRule[] {
  if (!Array.isArray(remote)) return DEFAULT_MDX_IMPORT_RULES;

  const rules: StandardImportRule[] = [];
  for (const entry of remote as RemoteImportEntry[]) {
    if (!entry || typeof entry.id !== "string") continue;

    if (typeof entry.line === "string") {
      const rule = ruleFromLine(entry.id, entry.line);
      if (rule) {
        rules.push(rule);
        continue;
      }
    }

    const known = computedRule(entry.id);
    if (known) rules.push(known);
  }

  return rules.length > 0 ? rules : DEFAULT_MDX_IMPORT_RULES;
}

const MD_IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

// Skips remote URLs and data URIs — only a local, relative image path
// makes sense to import as a bundler-resolved asset.
function isLocalImagePath(src: string): boolean {
  return !/^([a-z]+:)?\/\//i.test(src) && !src.startsWith("data:");
}

// Inserts a doc's front-matter-adjacent import block: whichever
// requiredImportRules aren't already present (checked against the
// *original*, unmodified content), in order, before whatever's already
// there. Idempotent and cheap when nothing's missing — safe to call on
// every save of an .mdx doc, not just at MD -> MDX conversion time, so a
// doc stays in sync if the remote standard changes later or a hand-
// edited file drifted from it.
function insertMissingImports(
  body: string,
  originalContent: string,
  docRelPath: string,
  requiredImportRules: StandardImportRule[],
  extraImports: string[] = [],
): string {
  const standardImports = requiredImportRules
    .filter((rule) => !rule.detect.test(originalContent))
    .map((rule) => rule.buildLine(docRelPath));

  const allImports = [...standardImports, ...extraImports];
  if (allImports.length === 0) return body;

  const frontmatterMatch = body.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  const insertOffset = frontmatterMatch ? frontmatterMatch[0].length : 0;
  const importBlock = allImports.join("\n") + "\n";
  return body.slice(0, insertOffset) + importBlock + body.slice(insertOffset);
}

// Brings an already-.mdx doc's imports up to the standard — no image
// conversion, just adding whatever required imports it's missing. Meant
// to run on every save of an open .mdx doc (see useDocEditor's
// saveDocument), so imports that would only otherwise get added at the
// one-time MD -> MDX conversion moment stay correct as a doc keeps
// changing afterward, or if the remote standard itself changes later.
// docRelPath is the doc's own workspace-relative path (e.g.
// "docs/testing/foo.mdx"), used only by computed rules (tabStyles) to
// target the right tabs.module.css copy.
export function applyMissingStandardImports(
  content: string,
  docRelPath: string,
  requiredImportRules: StandardImportRule[] = DEFAULT_MDX_IMPORT_RULES,
): string {
  return insertMissingImports(content, content, docRelPath, requiredImportRules);
}

// docRelPath is the doc's *new* (.mdx) workspace-relative path, e.g.
// "docs/testing/foo/bar.mdx" — used only by computed rules (tabStyles)
// to target the right tabs.module.css copy. Markdown image paths are
// left untouched as import specifiers since they're already relative to
// the doc's own folder, exactly like a hand-written import would be.
// requiredImportRules defaults to DEFAULT_MDX_IMPORT_RULES but is meant
// to be the (possibly remote-overridden) list resolved once at app
// start — see App.tsx's doc-standard check effect.
export function convertMdToMdx(
  content: string,
  docRelPath: string,
  requiredImportRules: StandardImportRule[] = DEFAULT_MDX_IMPORT_RULES,
): string {
  const imageImports: string[] = [];
  const body = content.replace(
    MD_IMAGE_RE,
    (match: string, alt: string, src: string) => {
      if (!isLocalImagePath(src)) return match;

      const filename = src.split("/").pop() || src;
      const varName = makeImportVarName(
        content + "\n" + imageImports.join("\n"),
        filename,
      );
      imageImports.push(`import ${varName} from "${src}";`);
      const altAttr = alt ? ` alt="${alt.replace(/"/g, "&quot;")}"` : "";
      return `<img src={${varName}}${altAttr} style={{ maxWidth: '100%' }} />`;
    },
  );

  return insertMissingImports(body, content, docRelPath, requiredImportRules, imageImports);
}
