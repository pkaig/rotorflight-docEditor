// Rewrites/strips ESM import & export statements in .mdx files so the
// browser-side MDX compiler (which has no bundler or module resolver) can
// evaluate the output standalone.
//
// - `import X from "./img.png"` (and other media extensions) becomes
//   `const X = "/api/docs/images/local?path=..."` so <img src={X}/> keeps working.
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

// Browser-safe path resolver (no Node "path" module available in-browser)
function joinPath(base: string, relative: string) {
  if (relative.startsWith("/")) return relative;

  const baseParts = base.split("/").slice(0, -1);
  const relParts = relative.split("/");

  for (const part of relParts) {
    if (part === "." || part === "") continue;
    if (part === "..") baseParts.pop();
    else baseParts.push(part);
  }

  return baseParts.join("/");
}

const MEDIA_RE = /\.(png|jpe?g|gif|svg|webp|mp4)$/i;

function parseStatement(code: string) {
  return (Parser.parse(code, { sourceType: "module", ecmaVersion: "latest" }) as any)
    .body[0];
}

function mediaImportDecls(names: string[], resolved: string) {
  const url = `/api/docs/images/local?path=${encodeURIComponent(resolved)}`;
  return names.map((name) =>
    parseStatement(`const ${name} = ${JSON.stringify(url)};`),
  );
}

export default function remarkStripImports() {
  return (tree: any, file: any) => {
    if (!file.path.endsWith(".mdx")) return;

    visit(tree, (node: any) => node.type === "mdxjsEsm", (node: any) => {
      const estree = node.data?.estree;
      if (!estree) return;

      const outStatements: any[] = [];

      for (const stmt of estree.body) {
        if (stmt.type === "ImportDeclaration") {
          const importPath = stmt.source.value;
          const resolved = joinPath(file.path, importPath);

          if (MEDIA_RE.test(resolved)) {
            const names = stmt.specifiers
              .map((s: any) => s.local?.name)
              .filter(Boolean);
            outStatements.push(...mediaImportDecls(names, resolved));
          }
          // Non-media imports can't be resolved in the sandbox — drop them.
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
    });
  };
}
