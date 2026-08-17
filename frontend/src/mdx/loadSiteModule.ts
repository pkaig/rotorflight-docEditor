/* frontend/src/mdx/loadSiteModule.ts
 *
 * Description of responsibility:
 *   Recursive loader for anything an MDX doc (or a component it pulls
 *   in) can import: media, CSS modules, JSON data, and
 *   .tsx/.jsx/.ts/.js components — resolving, fetching, and (for real
 *   components) transpiling + evaluating them on the fly, since there's
 *   no bundler available in the browser preview sandbox.
 *
 * Info:
 *   loadComponent() resolves every one of a component's own
 *   dependencies up front, before transpiling/evaluating it, because
 *   the transpiled code calls a synchronous require(spec) — by the
 *   time that runs, every specifier it can ask for must already be
 *   loaded and sitting in resolvedDeps. Babel is ~2-3MB and most docs
 *   never import a live component, so it's dynamically imported inside
 *   loadComponent() rather than at module scope, letting Vite split it
 *   into a chunk that only loads for docs that actually need it.
 *   cssModuleProxy() returns each requested class name back as its own
 *   string value, since there's no build step here to generate real
 *   CSS-module scoped names — just enough to keep
 *   `className={styles.x}` working; __esModule and then are excluded
 *   from the proxy so Babel's CJS interop helper doesn't misidentify it
 *   as a thenable/ES module.
 */
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import {
  resolveImportPath,
  MEDIA_RE,
  JSON_RE,
  CSS_RE,
} from "./resolveImportPath";
import { workspaceFileUrl, fetchWorkspaceText } from "./fetchWorkspaceFile";

const COMPONENT_RE = /\.(tsx|jsx|ts|js)$/i;

// Matches a single import statement's source specifier. Only the default
// or namespace form (`import X from "y"`) shows up in this codebase's
// components — good enough without pulling in a full parser just to find
// specifiers before we even know whether we need to fetch anything.
const IMPORT_SPECIFIER_RE = /^\s*import\s[^;]*?\sfrom\s+["']([^"']+)["']/gm;

export type LoadContext = {
  login: string;
  workspace: string;
  // resolvedPath -> raw CSS text, collected as a side effect for the
  // caller to inject into a <style> tag.
  cssTexts: Map<string, string>;
  cache: Map<string, Promise<unknown>>;
};

export function createLoadContext(
  login: string,
  workspace: string,
): LoadContext {
  return { login, workspace, cssTexts: new Map(), cache: new Map() };
}

// Returns the same "prop name back as its own value" for any class-name
// lookup (styles.wrapper -> "wrapper"), since there's no build step here
// to generate real scoped names — just enough to make `className={styles.x}`
// keep working. __esModule/then are excluded so Babel's CJS interop helper
// (which probes for __esModule) doesn't mistake this for an ES module and
// skip unwrapping the default export.
function cssModuleProxy(): Record<string, string> {
  return new Proxy(
    {},
    {
      get: (_target, prop) =>
        typeof prop === "string" && prop !== "__esModule" && prop !== "then"
          ? prop
          : undefined,
    },
  ) as Record<string, string>;
}

async function loadComponent(
  resolvedPath: string,
  ctx: LoadContext,
): Promise<unknown> {
  const source = await fetchWorkspaceText(
    resolvedPath,
    ctx.login,
    ctx.workspace,
  );

  // Resolve every dependency up front — the transpiled code below calls a
  // synchronous `require(spec)`, so by the time it runs, every specifier it
  // can ask for must already be loaded.
  const specifiers = new Set<string>();
  for (const m of source.matchAll(IMPORT_SPECIFIER_RE)) specifiers.add(m[1]);

  const resolvedDeps: Record<string, unknown> = {};
  await Promise.all(
    Array.from(specifiers).map(async (spec) => {
      if (spec === "react" || spec === "react/jsx-runtime") return;
      const resolved = resolveImportPath(resolvedPath, spec, ctx.workspace);
      resolvedDeps[spec] = await loadSiteModule(resolved, ctx);
    }),
  );

  const Babel = await import("@babel/standalone");
  const { code } = Babel.transform(source, {
    filename: resolvedPath,
    presets: [
      Babel.availablePresets["typescript"],
      Babel.availablePresets["react"],
    ],
    plugins: [Babel.availablePlugins["transform-modules-commonjs"]],
    sourceType: "module",
    babelrc: false,
    configFile: false,
  });

  function requireFn(spec: string) {
    if (spec === "react") return React;
    if (spec === "react/jsx-runtime") return jsxRuntime;
    if (spec in resolvedDeps) return resolvedDeps[spec];
    throw new Error(`Unresolved import "${spec}" in ${resolvedPath}`);
  }

  const moduleObj: { exports: Record<string, unknown> } = { exports: {} };
  const evaluate = new Function("require", "module", "exports", code!);
  evaluate(requireFn, moduleObj, moduleObj.exports);

  return moduleObj.exports.default ?? moduleObj.exports;
}

export async function loadSiteModule(
  resolvedPath: string,
  ctx: LoadContext,
): Promise<unknown> {
  const cached = ctx.cache.get(resolvedPath);
  if (cached) return cached;

  const promise = (async () => {
    if (MEDIA_RE.test(resolvedPath)) {
      return workspaceFileUrl(resolvedPath, ctx.login, ctx.workspace);
    }

    if (JSON_RE.test(resolvedPath)) {
      const text = await fetchWorkspaceText(
        resolvedPath,
        ctx.login,
        ctx.workspace,
      );
      return JSON.parse(text);
    }

    if (CSS_RE.test(resolvedPath)) {
      const text = await fetchWorkspaceText(
        resolvedPath,
        ctx.login,
        ctx.workspace,
      );
      ctx.cssTexts.set(resolvedPath, text);
      return cssModuleProxy();
    }

    if (COMPONENT_RE.test(resolvedPath)) {
      return loadComponent(resolvedPath, ctx);
    }

    // Unknown extension — best effort, hand back the raw text.
    return fetchWorkspaceText(resolvedPath, ctx.login, ctx.workspace);
  })();

  ctx.cache.set(resolvedPath, promise);
  return promise;
}

// Every entry in ctx.cache is guaranteed already-settled by the time the
// MDX compile finishes (remarkStripImports awaits loadSiteModule before
// moving on), so this just flattens it into the plain object the compiled
// doc's `__deps__[resolvedPath]` lookups expect at eval time.
export async function resolveDepsObject(
  ctx: LoadContext,
): Promise<Record<string, unknown>> {
  const entries = await Promise.all(
    Array.from(ctx.cache.entries()).map(async ([key, value]) => [
      key,
      await value,
    ]),
  );
  return Object.fromEntries(entries);
}
