import { useEffect, useRef, useState } from "react";
import { VFile } from "vfile";
import * as React from "react";

import { compile } from "@mdx-js/mdx/lib/compile.js";
import * as jsxRuntime from "react/jsx-runtime";

import remarkFrontmatter from "remark-frontmatter";
import remarkDirective from "remark-directive";
import remarkAdmonitions from "../remarkAdmonitions";
import remarkStripImports from "../mdx/remarkStripImports";
import { createLoadContext, resolveDepsObject } from "../mdx/loadSiteModule";

import rehypeImages from "../mdx/rehypeImagesPlugin";

import Tabs from "../mdx/Tabs";
import TabItem from "../mdx/TabItem";

// Compiles the current doc's MDX/Markdown source in-browser (no build step)
// and renders it. On compile/eval failure, falls back to a line-numbered
// raw view highlighting the offending line.
export default function Preview({
  content,
  currentDocPath,
  onError = () => {},
}) {
  const isImage = /\.(png|jpe?g|gif|svg|webp)$/i.test(currentDocPath);

  const [MDXContent, setMDXContent] = useState<any>(null);
  const [error, setError] = useState<any>(null);
  const [rawMode, setRawMode] = useState(false);

  // Raw CSS pulled in via .module.css imports (see loadSiteModule) has no
  // build step to scope it, so it's injected globally in a single tag that
  // gets fully replaced (not appended to) on every compile — otherwise
  // switching docs would leak one doc's styles into the next.
  const styleTagRef = useRef<HTMLStyleElement | null>(null);
  useEffect(() => {
    const tag = document.createElement("style");
    tag.setAttribute("data-rf-preview-css", "");
    document.head.appendChild(tag);
    styleTagRef.current = tag;
    return () => {
      tag.remove();
      styleTagRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    // hard reset on file/content change to avoid latching
    if (styleTagRef.current) styleTagRef.current.textContent = "";
    setError(null);
    setMDXContent(null);
    setRawMode(false);

    async function compileMdx() {
      // Images are rendered directly via <img>, not compiled as MDX.
      if (isImage) return;

      if (!content) {
        if (!cancelled) {
          setMDXContent(null);
          setError(null);
        }
        return;
      }

      const isMdx = currentDocPath.endsWith(".mdx");

      const vfile = new VFile({
        value: content,
        path: currentDocPath,
        cwd: "/",
      });

      const login = localStorage.getItem("rf_login") || "";
      const wsMatch = currentDocPath.match(/^local-workspace\/([^/]+)\//);
      const workspace = wsMatch ? wsMatch[1] : "";
      const loadCtx = createLoadContext(login, workspace);

      // frontmatter must be first so later plugins never see the leading
      // "---" block as markdown content; directive must precede admonitions
      // so ":::note" blocks are parsed before being turned into HTML.
      const commonPlugins = [remarkFrontmatter, remarkDirective, remarkAdmonitions];
      const remarkPlugins = isMdx
        ? [...commonPlugins, [remarkStripImports, loadCtx]]
        : commonPlugins;

      const rehypePlugins = [[rehypeImages, currentDocPath]];

      let compiled: any;

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

        const code = String(compiled.value || "");

        if (code.includes("import ") || code.includes("export ")) {
          // remarkStripImports should have rewritten/removed every
          // import/export node by this point; surviving ones will throw
          // a SyntaxError when wrapped in a function body below.
          console.error(
            "Unresolved import/export survived MDX compilation for",
            currentDocPath,
            code,
          );
        }

        try {
          const depsObj = await resolveDepsObject(loadCtx);

          if (styleTagRef.current) {
            styleTagRef.current.textContent = Array.from(
              loadCtx.cssTexts.values(),
            ).join("\n\n");
          }

          const wrapped = `
export default function(runtime) {
  const { Fragment, jsx, jsxs } = runtime;
  const Tabs = runtime.Tabs;
  const TabItem = runtime.TabItem;
  const __deps__ = runtime.__deps__;
  const __react__ = runtime.__react__;

  ${code}
}
`;

          const blob = new Blob([wrapped], { type: "text/javascript" });
          const url =
            URL.createObjectURL(blob) + `#${currentDocPath}-${Date.now()}`;

          const mod = await import(url);

          const evaluated = mod.default({
            ...jsxRuntime,
            Tabs,
            TabItem,
            __deps__: depsObj,
            __react__: React,
          });

          if (!cancelled) {
            const Component =
              evaluated && evaluated.default ? evaluated.default : evaluated;
            setMDXContent(() => Component);
            setError(null);
          }

          URL.revokeObjectURL(url);
        } catch (err: any) {
          const msg = err?.message || String(err);
          const match = msg.match(/line (\d+)/i);
          const line = match ? parseInt(match[1], 10) : null;

          console.error("MDX eval error for", currentDocPath, msg);

          if (!cancelled) {
            setError({ message: msg, line, path: currentDocPath });
            setMDXContent(() => () => renderFallback(content, line, msg));
          }
        }
      } catch (err: any) {
        const msg = err?.message || String(err);
        const match = msg.match(/line (\d+)/i);
        const line = match ? parseInt(match[1], 10) : null;

        console.error("MDX compile error for", currentDocPath, msg);

        if (!cancelled) {
          setError({ message: msg, line, path: currentDocPath });
          setMDXContent(() => () => renderFallback(content, line, msg));
        }
      }
    }

    compileMdx();

    return () => {
      cancelled = true;
    };
  }, [content, currentDocPath, isImage]);

  useEffect(() => {
    if (error && onError) onError(error.line || null);
    else onError(null);
  }, [error, onError]);

  if (isImage) {
    // /api/docs/images/local requires login + workspace (see docsRoutes.ts
    // requireToken), same as rehypeImagesPlugin.ts's in-content <img> src.
    const login = localStorage.getItem("rf_login") || "";
    const wsMatch = currentDocPath.match(/^local-workspace\/([^/]+)\//);
    const workspace = wsMatch ? wsMatch[1] : "";
    const params = new URLSearchParams({
      path: currentDocPath,
      login,
      workspace,
    });
    const url = `/api/docs/images/local?${params.toString()}`;
    return (
      <div className="rf-preview">
        <img
          src={url}
          alt={currentDocPath}
          style={{ maxWidth: "100%", height: "auto", display: "block" }}
        />
      </div>
    );
  }

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
    return <div className="rf-preview" />;
  }

  return (
    <div className="rf-preview">
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
        <MDXContent key={currentDocPath} components={{ Tabs, TabItem }} />
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
