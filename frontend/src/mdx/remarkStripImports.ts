// Rewrites/strips ESM import & export statements in .mdx files so the
// browser-side MDX compiler (which has no bundler or module resolver) can
// evaluate the output standalone.
//
// - Media imports (images/video) become `const X = "/api/docs/images/local?..."`.
// - CSS module, JSON, and component (.tsx/.jsx/.ts/.js) imports — including
//   ones using Docusaurus's `@site/` site-root alias — are resolved via
//   loadSiteModule (fetched, transpiled if needed) and rewritten to pull
//   from a `__deps__` runtime object the caller injects at eval time.
// - `import ... from "react"` becomes a destructure off a `__react__`
//   runtime global (same reasoning as `__deps__`).
// - `@theme/...` imports (Tabs/TabItem) are dropped — Preview.tsx already
//   injects those by name as runtime globals, since they're Docusaurus
//   theme internals with nothing to fetch.
// - Any other import/export is dropped, since it can't be resolved at
//   runtime in the preview sandbox.
//
// MDX parses import/export statements into `mdxjsEsm` mdast nodes, and
// `hast-util-to-estree` emits code for them straight from `node.data.estree`
// (see hast-util-to-estree/lib/handlers/mdxjs-esm.js) — it never looks at
// `node.value`. So the rewrite has to happen on the ESTree itself; editing
// `node.value` alone compiles to nothing.
import { visit } from "unist-util-visit";
import { Parser } from "acorn";
import { resolveImportPath, MEDIA_RE } from "./resolveImportPath";
import { loadSiteModule, type LoadContext } from "./loadSiteModule";
import { workspaceFileUrl } from "./fetchWorkspaceFile";

function parseStatement(code: string) {
  return (Parser.parse(code, { sourceType: "module", ecmaVersion: "latest" }) as any)
    .body[0];
}

function mediaImportDecls(names: string[], resolved: string, ctx: LoadContext) {
  const url = workspaceFileUrl(resolved, ctx.login, ctx.workspace);
  return names.map((name) =>
    parseStatement(`const ${name} = ${JSON.stringify(url)};`),
  );
}

function reactImportDecls(specifiers: any[]) {
  return specifiers
    .map((s: any) => {
      const local = s.local?.name;
      if (!local) return null;
      if (s.type === "ImportSpecifier") {
        return parseStatement(`const ${local} = __react__.${s.imported.name};`);
      }
      // Default or namespace import — react's default export IS the
      // namespace object, so both forms resolve the same way here.
      return parseStatement(`const ${local} = __react__;`);
    })
    .filter(Boolean);
}

function depImportDecls(specifiers: any[], resolved: string) {
  const key = JSON.stringify(resolved);
  return specifiers
    .map((s: any) => {
      const local = s.local?.name;
      if (!local) return null;
      if (s.type === "ImportSpecifier") {
        return parseStatement(`const ${local} = __deps__[${key}].${s.imported.name};`);
      }
      return parseStatement(`const ${local} = __deps__[${key}];`);
    })
    .filter(Boolean);
}

export default function remarkStripImports(ctx: LoadContext) {
  return async (tree: any, file: any) => {
    if (!file.path.endsWith(".mdx")) return;

    const nodes: any[] = [];
    visit(tree, (node: any) => node.type === "mdxjsEsm", (node: any) => {
      nodes.push(node);
    });

    for (const node of nodes) {
      const estree = node.data?.estree;
      if (!estree) continue;

      const outStatements: any[] = [];

      for (const stmt of estree.body) {
        if (stmt.type === "ImportDeclaration") {
          const importPath = stmt.source.value as string;

          if (importPath === "react") {
            outStatements.push(...reactImportDecls(stmt.specifiers));
            continue;
          }

          // Docusaurus theme internals (Tabs/TabItem) — nothing to fetch,
          // Preview.tsx injects these by name already.
          if (importPath.startsWith("@theme/")) continue;

          const resolved = resolveImportPath(file.path, importPath, ctx.workspace);

          if (MEDIA_RE.test(resolved)) {
            const names = stmt.specifiers
              .map((s: any) => s.local?.name)
              .filter(Boolean);
            outStatements.push(...mediaImportDecls(names, resolved, ctx));
            continue;
          }

          // CSS module / JSON / component (including @site-aliased ones).
          await loadSiteModule(resolved, ctx);
          outStatements.push(...depImportDecls(stmt.specifiers, resolved));
          continue;
        }

        // Exports (frontmatter-style `export const meta = ...`, etc.) have
        // no consumer in the preview sandbox — drop them too.
        if (
          stmt.type === "ExportNamedDeclaration" ||
          stmt.type === "ExportDefaultDeclaration" ||
          stmt.type === "ExportAllDeclaration"
        ) {
          continue;
        }

        outStatements.push(stmt);
      }

      estree.body = outStatements;
      node.value = "";
    }
  };
}
