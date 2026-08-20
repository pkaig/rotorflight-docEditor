/* frontend/src/components/Preview.tsx
 *
 * Description of responsibility:
 *   Compiles the current doc's MDX/Markdown source in the browser (no
 *   build step) via @mdx-js/mdx and evaluates the result to render a
 *   live preview, falling back to a line-numbered raw view
 *   highlighting the offending line on compile/eval failure.
 *
 * Info:
 *   The compile effect deliberately does not fire on every keystroke:
 *   switching to a new document recompiles after a short 60ms settle
 *   window (see lastPathRef), while continuing to type in the same
 *   document waits a full 3000ms of inactivity — and does not clear
 *   MDXContent first, so the previously-rendered version stays on
 *   screen until the next one is ready rather than flashing blank. The
 *   60ms settle window exists because useDocEditor's loadDoc sets
 *   currentDocPath synchronously but content asynchronously, so
 *   opening a file fires this effect twice in quick succession; not
 *   eagerly marking lastPathRef as "seen" on the first fire means
 *   whichever fire still has current content when the timer elapses is
 *   the one that compiles.
 */
import { useEffect, useRef, useState } from "react";
import * as React from "react";

import { compile } from "@mdx-js/mdx/lib/compile.js";
import * as jsxRuntime from "react/jsx-runtime";

import remarkFrontmatter from "remark-frontmatter";
import remarkDirective from "remark-directive";
// "remark-gfm-mdx" is an npm alias for remark-gfm@3, not the project's
// normal (v4) remark-gfm — see the compile-plugin comment below for why.
import remarkGfm from "remark-gfm-mdx";
import remarkAdmonitions from "../remarkAdmonitions";
import remarkStripImports from "../mdx/remarkStripImports";
import { createLoadContext, resolveDepsObject } from "../mdx/loadSiteModule";

import rehypeImages from "../mdx/rehypeImagesPlugin";

import Tabs from "../mdx/Tabs";
import TabItem from "../mdx/TabItem";

// Compiles the current doc's MDX/Markdown source in-browser (no build step)
// and renders it. On compile/eval failure, falls back to a line-numbered
// raw view highlighting the offending line.
interface PreviewProps {
  content: string;
  currentDocPath: string;
  onError?: (line: number | null) => void;
  // Called after a successful in-place image replacement (see the
  // "Update image" button below) so App.tsx can refresh the tree/Changes
  // panel — this component has no other way to signal that back up.
  onImageUpdated?: () => void;
}

export default function Preview({
  content,
  currentDocPath,
  onError = () => {},
  onImageUpdated = () => {},
}: PreviewProps) {
  const isImage = /\.(png|jpe?g|gif|svg|webp)$/i.test(currentDocPath);

  const [MDXContent, setMDXContent] = useState<any>(null);
  const [error, setError] = useState<any>(null);
  const [rawMode, setRawMode] = useState(false);
  // Cache-busts the displayed <img> after a successful update — the URL
  // itself would otherwise be byte-identical to what the browser already
  // has cached, so a fresh fetch never happens without this.
  const [imageCacheBust, setImageCacheBust] = useState(0);
  const [updatingImage, setUpdatingImage] = useState(false);
  const imageUpdateInputRef = useRef<HTMLInputElement>(null);

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

  // Tracks the doc actually open, as opposed to its content changing —
  // switching files should render immediately, typing in the same file
  // should not recompile (and flash/reset scroll) on every keystroke.
  const lastPathRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // loadDoc sets currentDocPath synchronously, then content lands
    // separately once its fetch resolves — so opening a file fires this
    // effect twice: once with the new path but the *previous* file's
    // still-stale content, then again moments later with content caught
    // up but currentDocPath unchanged. Only marking the ref "seen" once a
    // compile actually fires (not eagerly here) means both fires still
    // count as "new doc" and each one's short timer cancels the last, so
    // whichever fire's content is still current when things settle is the
    // one that actually compiles — never the stale intermediate one.
    const isNewDoc = lastPathRef.current !== currentDocPath;

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

      // A plain compatible object, not `new VFile(...)` — the root `vfile`
      // package and @mdx-js/mdx's own bundled copy of it are structurally
      // identical but nominally different classes (a dual-package hazard),
      // so an actual VFile instance built from the root package doesn't
      // type-check against compile()'s own nested VFile type. compile()
      // accepts this plain options shape directly and wraps it internally.
      const vfile = { value: content, path: currentDocPath, cwd: "/" };

      const login = localStorage.getItem("rf_login") || "";
      const wsMatch = currentDocPath.match(/^local-workspace\/([^/]+)\//);
      const workspace = wsMatch ? wsMatch[1] : "";
      const loadCtx = createLoadContext(login, workspace);

      // Typed `any[]`, not the `unified` package's own `PluggableList`: the
      // root `unified` package and @mdx-js/mdx's own bundled copy of it are
      // structurally identical but nominally different types (the same
      // dual-package hazard as vfile above), so a plugin list built against
      // the root package's Plugin type doesn't type-check against
      // compile()'s own nested Plugin type.
      //
      // frontmatter must be first so later plugins never see the leading
      // "---" block as markdown content; directive must precede admonitions
      // so ":::note" blocks are parsed before being turned into HTML.
      // remarkGfm adds table/strikethrough/task-list/autolink syntax —
      // none of that is part of standard CommonMark, so without it a
      // real doc's markdown tables were just falling through as literal
      // pipe-delimited text instead of becoming an actual <table>.
      //
      // remarkGfm here is specifically the "remark-gfm-mdx" import (an
      // npm alias for remark-gfm@3, see the top of this file) — plain
      // remark-gfm@4 depends on a micromark-extension-gfm-table version
      // built for micromark v4's tokenizer internals, but compile() here
      // runs through @mdx-js/mdx's own bundled, older micromark v3
      // pipeline (another instance of the dual-package hazard this file
      // already works around for vfile/unified above), so a v4-generation
      // GFM extension crashed with "Cannot read properties of undefined
      // (reading 'inTable')" the moment it hit an actual table. Plain
      // remark-gfm (v4) stays the right choice for
      // spellcheck/tokenizeMarkdown.ts's separate pipeline, which runs on
      // the project's normal (newer) top-level unified/remark-parse —
      // downgrading it there broke spell-check tokenization instead
      // ("this.setData is not a function"), so both versions are kept
      // side by side rather than picking one for the whole project.
      const commonPlugins: any[] = [
        remarkFrontmatter,
        remarkGfm,
        remarkDirective,
        remarkAdmonitions,
      ];
      const remarkPlugins: any[] = isMdx
        ? [...commonPlugins, [remarkStripImports, loadCtx]]
        : commonPlugins;

      const rehypePlugins: any[] = [[rehypeImages, currentDocPath]];

      let compiled: any;

      try {
        compiled = await compile(vfile, {
          jsx: false,
          outputFormat: "function-body",
          development: false,
          // Not a real @mdx-js/mdx compile option (no such property exists
          // in this version's CompileOptions) — was already a silent no-op
          // at runtime; removed rather than kept as dead configuration.
          remarkPlugins,
          rehypePlugins,
          useDynamicImport: false,
          providerImportSource: null,
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

    function runCompile() {
      // Hard reset avoids latching stale content/error state — but only
      // blank the preview out for an actual document switch. While the
      // user is still typing in the same doc, the last successfully
      // compiled version stays on screen until the new one is ready, so
      // there's a single clean swap instead of a blank-then-refill flash.
      if (isNewDoc) lastPathRef.current = currentDocPath;
      if (styleTagRef.current) styleTagRef.current.textContent = "";
      setError(null);
      setRawMode(false);
      compileMdx();
    }

    if (isNewDoc) {
      setMDXContent(null);
      // Short settle window, not a synchronous compile — coalesces the
      // stale-content fire and the real-content fire described above into
      // one compile using whichever content is still current 60ms later,
      // while still feeling instant to the user.
      const timer = setTimeout(runCompile, 60);
      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
    }

    // Same doc, content changed from typing — wait for a pause before
    // recompiling instead of doing it on every keystroke.
    const timer = setTimeout(runCompile, 3000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [content, currentDocPath, isImage]);

  useEffect(() => {
    if (error && onError) onError(error.line || null);
    else onError(null);
  }, [error, onError]);

  useEffect(() => {
    setImageCacheBust(0);
  }, [currentDocPath]);

  if (isImage) {
    // /api/docs/images/local requires login + workspace (see docsRoutes.ts
    // requireToken), same as rehypeImagesPlugin.ts's in-content <img> src.
    const login = localStorage.getItem("rf_login") || "";
    const wsMatch = currentDocPath.match(/^local-workspace\/([^/]+)\//);
    const workspace = wsMatch ? wsMatch[1] : "";
    const relPath = currentDocPath.replace(/^local-workspace\/[^/]+\//, "");
    const folder = relPath.replace(/\/[^/]+$/, "");
    const filename = relPath.split("/").pop() || "";

    const params = new URLSearchParams({
      path: currentDocPath,
      login,
      workspace,
    });
    if (imageCacheBust) params.set("t", String(imageCacheBust));
    const url = `/api/docs/images/local?${params.toString()}`;

    async function handleReplace(file: File) {
      // Uploads under the image's own existing filename, not the picked
      // file's — this replaces the content in place so every doc already
      // referencing it (by that exact name) keeps working, rather than
      // creating a second, differently-named image alongside it.
      const renamed = new File([file], filename, { type: file.type });
      const formData = new FormData();
      formData.append("folder", folder);
      formData.append("file", renamed);

      setUpdatingImage(true);
      try {
        const res = await fetch(
          `/api/docs/local/upload?login=${encodeURIComponent(login)}&workspace=${encodeURIComponent(workspace)}`,
          { method: "POST", body: formData },
        );
        if (!res.ok) throw new Error("Upload failed");
        setImageCacheBust(Date.now());
        onImageUpdated();
      } catch (err) {
        alert(err instanceof Error ? err.message : "Failed to update image");
      } finally {
        setUpdatingImage(false);
      }
    }

    return (
      <div className="rf-preview">
        <img
          key={url}
          src={url}
          alt={currentDocPath}
          style={{ maxWidth: "100%", height: "auto", display: "block" }}
        />
        <input
          ref={imageUpdateInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleReplace(file);
            e.target.value = "";
          }}
        />
        <button
          className="update-image-btn"
          disabled={updatingImage}
          onClick={() => imageUpdateInputRef.current?.click()}
        >
          {updatingImage ? "Updating…" : "Update image…"}
        </button>
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
