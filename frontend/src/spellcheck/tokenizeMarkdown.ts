// Extracts spell-checkable words (with their character offsets in the
// original source) from Markdown/MDX prose, skipping code spans, fenced
// code blocks, frontmatter, link/image URLs, and MDX-specific constructs —
// import/export statements, JSX tags + their attributes, and {expression}
// interpolations — anything that isn't prose a human typed and might have
// misspelled.
//
// remark-mdx gives these constructs their own node types (mdxjsEsm,
// mdxJsxFlowElement/mdxJsxTextElement, mdxFlowExpression/mdxTextExpression)
// instead of letting them fall through and get misparsed as plain
// paragraph text — which is what happened without it: a JSX tag name or
// an import's module path could end up spell-checked like prose. JSX
// element *children* (the actual rendered text inside a component, e.g.
// `<TabItem>real prose</TabItem>`) are still walked normally, since only
// the tag/attributes live outside the visited "text" nodes, not the
// children.
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import { visit, SKIP } from "unist-util-visit";

export interface WordToken {
  word: string;
  start: number;
  end: number;
}

const SKIP_NODE_TYPES = new Set([
  "code",
  "inlineCode",
  "html",
  "yaml",
  "toml",
  "definition",
  "footnoteDefinition",
  "mdxjsEsm",
  "mdxFlowExpression",
  "mdxTextExpression",
]);

// 2+ letter runs, allowing an internal hyphen/apostrophe (e.g. "don't",
// "well-known"). Single letters are excluded to avoid flagging units like
// "V" or "A" in values such as "3.3V".
const WORD_RE = /[A-Za-z]{2,}(?:['-][A-Za-z]+)*/g;

export function tokenizeMarkdown(source: string): WordToken[] {
  let tree: any;
  try {
    tree = unified()
      .use(remarkParse)
      .use(remarkFrontmatter)
      .use(remarkGfm)
      .use(remarkMdx)
      .parse(source);
  } catch {
    // Invalid/incomplete MDX syntax mid-edit — skip this pass rather than
    // crash; the next debounced pass will pick up once it's parseable.
    return [];
  }

  const tokens: WordToken[] = [];

  visit(tree, (node: any) => {
    if (SKIP_NODE_TYPES.has(node.type)) return SKIP;
    if (node.type !== "text" || !node.position) return;

    const value: string = node.value ?? "";
    const startOffset: number = node.position.start.offset;

    WORD_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WORD_RE.exec(value))) {
      tokens.push({
        word: m[0],
        start: startOffset + m.index,
        end: startOffset + m.index + m[0].length,
      });
    }
  });

  return tokens;
}
