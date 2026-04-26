import { useEffect, useState } from "react";
import { VFile } from "vfile";

import { compile } from "@mdx-js/mdx/lib/compile.js";
import * as realRuntime from "react/jsx-runtime";

import remarkParse from "remark-parse";
import remarkMdx from "remark-mdx";
import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";
import remarkAdmonitions from "../remarkAdmonitions";
import remarkImportedImages from "../mdx/remarkImportedImages";

import rehypeImages from "../mdx/rehypeImagesPlugin";

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

  const [MDXContent, setMDXContent] = useState<any>(null);
  const [error, setError] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;

    async function compileMdx() {
      if (!content) {
        setMDXContent(null);
        return;
      }

      try {
        const vfile = new VFile({
          value: content,
          path: currentDocPath,
        });

        const isMdx = currentDocPath.endsWith(".mdx");

        // ⭐ FINAL PIPELINE SPLIT
        const remarkPlugins = isMdx
          ? [
              remarkParse,
              remarkMdx,
              remarkGfm,
              remarkDirective,
              remarkAdmonitions,
              remarkImportedImages, // MDX: rewrite imports
            ]
          : [
              remarkParse,
              remarkImportedImages, // MD: rewrite imports only
            ];

        const rehypePlugins = [
          [rehypeImages, currentDocPath], // MD + MDX: rewrite <img>
        ];

        const compiled = await compile(vfile, {
          jsx: isMdx,
          jsxImportSource: isMdx ? "react" : undefined,
          providerImportSource: isMdx ? "react" : undefined,
          useDynamicImport: isMdx,
          outputFormat: "function-body",
          development: false,
          allowDangerousHtml: true,
          remarkPlugins,
          rehypePlugins,
        });

        const wrapped = `
          export default function(runtime) {
            const { Fragment, jsx, jsxs } = runtime;
            ${compiled.value}
          }
        `;

        const blob = new Blob([wrapped], { type: "text/javascript" });
        const url = URL.createObjectURL(blob);

        const mod = await import(url);
        const evaluated = mod.default(realRuntime);

        if (!cancelled) {
          setMDXContent(() => evaluated.default);
          setError(null);
        }

        URL.revokeObjectURL(url);
      } catch (err: any) {
        if (!cancelled) {
          const msg = err.message || String(err);
          const match = msg.match(/line (\d+)/i);
          const line = match ? parseInt(match[1], 10) : null;

          setError({ message: msg, line });
          setMDXContent(null);
        }
      }
    }

    compileMdx();
    return () => {
      cancelled = true;
    };
  }, [content, currentDocPath]);

  useEffect(() => {
    if (error && onError) onError(error.line || null);
    else onError(null);
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

  if (!MDXContent) {
    return <div className="markdown-body" />;
  }

  return (
    <div className="markdown-body">
      <MDXContent components={{}} />
    </div>
  );
}
