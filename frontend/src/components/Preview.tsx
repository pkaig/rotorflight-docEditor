import { useEffect, useState } from "react";
import { VFile } from "vfile";

import { compile } from "@mdx-js/mdx/lib/compile.js";
import * as realRuntime from "react/jsx-runtime";

import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";
import remarkAdmonitions from "../remarkAdmonitions";
import remarkImportedImages from "../mdx/remarkImportedImages";
import remarkStripImports from "../mdx/remarkStripImports";

import rehypeImages from "../mdx/rehypeImagesPlugin";

import Tabs from "../mdx/Tabs";
import TabItem from "../mdx/TabItem";
import tabStyles from "../css/tabs.module.css";

// debug toggles
const debug = true;
const debugTimer = true;
const debugAst = true;
const debugEval = true;

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
        const isMdx = currentDocPath.endsWith(".mdx");

        if (debug) {
          console.group("📄 MDX DEBUG");
          console.log("File:", currentDocPath);
          console.log("Type:", isMdx ? "MDX" : "Markdown");
          console.log("debugTimer:", debugTimer);
          console.log("debugAst:", debugAst);
          console.log("debugEval:", debugEval);
        }

        const vfile = new VFile({
          value: content,
          path: currentDocPath,
        });

        const remarkPlugins = isMdx
          ? [
              remarkDirective,
              remarkAdmonitions,
              remarkImportedImages,
              remarkStripImports, // guarded by .mdx path
            ]
          : [
              // No remarkGfm here – avoids inTable crash
              remarkImportedImages,
            ];

        const rehypePlugins = [[rehypeImages, currentDocPath]];

        // ⭐ TIMING PROFILER
        let timing = {};
        const time = (label, fn) => {
          if (!debugTimer) return fn();
          const start = performance.now();
          const result = fn();
          const end = performance.now();
          timing[label] = (end - start).toFixed(2) + "ms";
          return result;
        };

        // ⭐ Compile with timing
        const compiled = await time("compile", () =>
          compile(vfile, {
            jsx: false, // ⭐ emit runtime-ready JS
            outputFormat: "function-body", // ⭐ works with our wrapper
            development: false,
            allowDangerousHtml: true,
            remarkPlugins,
            rehypePlugins,
          }),
        );

        if (debugTimer) {
          console.group("⏱️ MDX Plugin Timing");
          console.table(timing);
          console.groupEnd();
        }

        if (debugEval) {
          console.group("🧩 Compiled Output");
          console.log(compiled.value);
          console.groupEnd();
        }

        // ⭐ Wrap module — inject tabStyles into JS scope
        const wrapped = `
          export default function(runtime) {
            const tabStyles = runtime.tabStyles;
            ${compiled.value}
          }
        `;

        if (debugEval) {
          console.group("📦 Wrapped Module");
          console.log(wrapped);
          console.groupEnd();
        }

        const blob = new Blob([wrapped], { type: "text/javascript" });
        const url = URL.createObjectURL(blob);

        if (debugEval) console.log("Blob URL:", url);

        const mod = await import(url);

        if (debugEval) {
          console.group("📥 Imported Module");
          console.log(mod);
          console.groupEnd();
        }

        // ⭐ Inject runtime + tabStyles
        const evaluated = mod.default({
          ...realRuntime,
          tabStyles,
        });

        if (debugEval) {
          console.group("⚙️ Evaluated MDX");
          console.log(evaluated);
          console.groupEnd();
        }

        if (!cancelled) {
          setMDXContent(() => evaluated.default);
          setError(null);
        }

        URL.revokeObjectURL(url);
      } catch (err: any) {
        if (debugAst) {
          console.group("🌳 AST Dump (on error)");
          try {
            console.log("Tree:", err.tree || "(no tree available)");
          } catch {}
          console.groupEnd();
        }

        if (debugEval || debugTimer || debugAst) {
          console.group("❌ MDX ERROR");
          console.error(err);
          console.groupEnd();
        }

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
      <MDXContent key={currentDocPath} components={{ Tabs, TabItem }} />
    </div>
  );
}
