import { useEffect, useMemo } from "react";
import { unified } from "unified";
import { VFile } from "vfile";
import { visit } from "unist-util-visit";

import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";
import remarkAdmonitions from "../remarkAdmonitions";
import remarkRehype from "remark-rehype";
import remarkMdx from "remark-mdx";
import remarkFrontmatter from "remark-frontmatter";
import remarkMdxFrontmatter from "remark-mdx-frontmatter";

import rehypeImages from "../mdx/rehypeImagesPlugin";
import remarkImportedImages from "../mdx/remarkImportedImages";

import { mdxjs } from "micromark-extension-mdxjs";
import { mdxFromMarkdown, mdxToMarkdown } from "mdast-util-mdx";

import rehypeStringify from "rehype-stringify";

export default function Preview({
  content,
  currentDocPath,
  onError = () => {},
}) {
  const isImage = /\.(png|jpe?g|gif|svg|webp)$/i.test(currentDocPath);

  // IMAGE MODE
  if (isImage) {
    const url = `/api/docs/images/local?path=${encodeURIComponent(
      currentDocPath,
    )}`;
    return (
      <div className="markdown-body">
        <img
          src={url}
          alt={currentDocPath}
          style={{ maxWidth: "100%", height: "auto", display: "block" }}
        />
      </div>
    );
  }

  // MARKDOWN / MDX MODE
  const { html, error } = useMemo(() => {
    if (!content) return { html: "", error: null };

    try {
      const vfile = new VFile({
        value: content,
        path: currentDocPath,
      });

      const file = unified()
        .use(remarkParse)
        .use(remarkFrontmatter, ["yaml"]) // ⭐ parse YAML
        .use(remarkMdxFrontmatter) // ⭐ convert YAML → MDX ESM
        .use(remarkMdx) // ⭐ now MDX imports are parsed correctly
        .use({
          settings: {
            extensions: [mdxjs()],
            mdastExtensions: [mdxFromMarkdown()],
          },
        })
        .use(remarkGfm)
        .use(remarkDirective)
        .use(remarkAdmonitions)
        .use(() => (tree, file) => {
          console.log("🟦 PRE-PLUGIN AST NODES:");
          let count = 0;
          visit(tree, (node) => {
            if (node.type === "mdxjsEsm") {
              console.log("Found mdxjsEsm node:", node);
              count++;
            }
          });
          console.log("Total mdxjsEsm nodes:", count);
        })
        .use(remarkImportedImages) // ⭐ now sees mdxjsEsm nodes
        .use(remarkRehype, { allowDangerousHtml: true })
        .use(rehypeImages, currentDocPath)
        .use(rehypeStringify)
        .processSync(vfile);

      return { html: String(file), error: null };
    } catch (err) {
      const msg = err.message || String(err);
      const match = msg.match(/line (\d+)/i);
      const line = match ? parseInt(match[1], 10) : null;

      return {
        html: "",
        error: { message: msg, line },
      };
    }
  }, [content, currentDocPath]);

  useEffect(() => {
    if (error && onError) {
      onError(error.line || null);
    } else if (onError) {
      onError(null);
    }
  }, [error, onError]);

  if (error) {
    return (
      <div
        style={{
          borderLeft: "6px solid #e53935",
          background: "#ffebee",
          padding: "1rem",
          borderRadius: 6,
          margin: "1rem 0",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: "0.5rem" }}>
          Preview Error
        </div>
        <div style={{ fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
          {error.message}
          {error.line && `\n\nPossible issue near line ${error.line}.`}
        </div>
      </div>
    );
  }

  return (
    <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
  );
}
