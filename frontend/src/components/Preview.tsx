import { useEffect, useState } from "react";
import { VFile } from "vfile";

import { compile } from "@mdx-js/mdx/lib/compile.js";
import * as jsxRuntime from "react/jsx-runtime";

import remarkDirective from "remark-directive";
import remarkAdmonitions from "../remarkAdmonitions";
import remarkImportedImages from "../mdx/remarkImportedImages";
import remarkStripImports from "../mdx/remarkStripImports";

import rehypeImages from "../mdx/rehypeImagesPlugin";

import Tabs from "../mdx/Tabs";
import TabItem from "../mdx/TabItem";
import tabStyles from "../css/tabs.module.css";

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
  const [rawMode, setRawMode] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function compileMdx() {
      if (!content) {
        setMDXContent(null);
        return;
      }

      const isMdx = currentDocPath.endsWith(".mdx");

      const vfile = new VFile({
        value: content,
        path: currentDocPath,
      });

      const remarkPlugins = isMdx
        ? [
            remarkDirective,
            remarkAdmonitions,
            remarkImportedImages,
            remarkStripImports,
          ]
        : [remarkImportedImages];

      const rehypePlugins = [[rehypeImages, currentDocPath]];

      let compiled;

      try {
        compiled = await compile(vfile, {
          jsx: false,
          outputFormat: "function-body",
          development: false,
          allowDangerousHtml: true,
          remarkPlugins,
          rehypePlugins,
          useDynamicImport: false,
          providerImportSource: false,
        });
      } catch (err: any) {
        const msg = err?.message || String(err);
        const match = msg.match(/line (\d+)/i);
        const line = match ? parseInt(match[1], 10) : null;

        if (!cancelled) {
          setError({ message: msg, line });
          setMDXContent(() => () => renderFallback(content, line, msg));
        }
        return;
      }

      if (typeof compiled.value === "string") {
        const code = compiled.value as string;
        if (code.includes("import ") || code.includes("export ")) {
          console.error(
            "❌ RAW IMPORT/EXPORT STILL IN COMPILED OUTPUT for",
            currentDocPath,
          );
          console.error(code);
        }
      }

      try {
        const wrapped = `
export default function(runtime) {
  const { Fragment, jsx, jsxs } = runtime;
  const Tabs = runtime.Tabs;
  const TabItem = runtime.TabItem;
  const tabStyles = runtime.tabStyles;

  ${compiled.value}
}
`;

        const blob = new Blob([wrapped], { type: "text/javascript" });
        const url = URL.createObjectURL(blob);
        const mod = await import(url);

        const evaluated = mod.default({
          ...jsxRuntime,
          Tabs,
          TabItem,
          tabStyles,
        });

        if (!cancelled) {
          setMDXContent(() => evaluated.default);
          setError(null);
        }

        URL.revokeObjectURL(url);
      } catch (err: any) {
        const msg = err?.message || String(err);
        const match = msg.match(/line (\d+)/i);
        const line = match ? parseInt(match[1], 10) : null;

        if (!cancelled) {
          setError({ message: msg, line });
          setMDXContent(() => () => renderFallback(content, line, msg));
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
      <div style={{ marginBottom: "0.5rem" }}>
        <button
          onClick={() => setRawMode(!rawMode)}
          style={{
            padding: "4px 10px",
            fontSize: "0.8rem",
            cursor: "pointer",
            borderRadius: 4,
          }}
        >
          {rawMode ? "Show Rendered" : "Show Raw"}
        </button>
      </div>

      {rawMode ? (
        renderFallback(content, error?.line, error?.message)
      ) : (
        <MDXContent components={{ Tabs, TabItem }} />
      )}
    </div>
  );
}

/* -------------------------------------------------------------
   Fallback Renderer
------------------------------------------------------------- */

function renderFallback(
  content: string,
  errorLine: number | null,
  tooltip: string | null,
) {
  const lines = content.split("\n");

  return (
    <pre style={{ whiteSpace: "pre-wrap", fontFamily: "monospace" }}>
      {lines.map((ln, i) => {
        const lineNumber = i + 1;
        const isError = errorLine === lineNumber;

        return (
          <div
            key={i}
            title={isError && tooltip ? tooltip : ""}
            style={{
              display: "flex",
              background: isError ? "#ffe6e6" : "transparent",
              borderLeft: isError
                ? "4px solid #e53935"
                : "4px solid transparent",
            }}
          >
            <span
              style={{
                width: "3rem",
                textAlign: "right",
                paddingRight: "0.5rem",
                opacity: 0.6,
                userSelect: "none",
              }}
            >
              {lineNumber}
            </span>

            <span
              style={{
                flex: 1,
                paddingLeft: "0.5rem",
                color: syntaxColor(ln),
              }}
            >
              {ln}
            </span>
          </div>
        );
      })}
    </pre>
  );
}

function syntaxColor(line: string) {
  if (line.trim().startsWith("#")) return "#005cc5";
  if (line.trim().startsWith("import")) return "#d73a49";
  if (line.trim().startsWith("export")) return "#d73a49";
  if (line.includes(":::")) return "#6f42c1";
  if (line.trim().startsWith("* ")) return "#22863a";
  if (line.includes("`")) return "#e36209";
  return "inherit";
}
