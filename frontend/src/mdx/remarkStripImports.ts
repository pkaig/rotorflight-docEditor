import { visit } from "unist-util-visit";

// Browser-safe path resolver
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

export default function remarkStripImports() {
  return (tree: any, file: any) => {
    if (!file.path.endsWith(".mdx")) return;

    console.log("🧩 remarkStripImports: file =", file.path);

    let tableDepth = 0;

    visit(
      tree,
      (node: any) =>
        node.type === "mdxjsEsm" ||
        node.type === "import" ||
        node.type === "export" ||
        node.type === "table" ||
        node.type === "tableRow" ||
        node.type === "tableCell",
      (node: any, index: number | null, parent: any) => {
        // ENTER table
        if (
          node.type === "table" ||
          node.type === "tableRow" ||
          node.type === "tableCell"
        ) {
          tableDepth++;
          return () => {
            tableDepth--;
          };
        }

        if (tableDepth > 0) return;

        // Debug log
        if (
          node.type === "mdxjsEsm" ||
          node.type === "import" ||
          node.type === "export"
        ) {
          console.log(
            "📦 IMPORT/EXPORT NODE:",
            JSON.stringify(
              {
                type: node.type,
                file: file.path,
                value: node.value,
                source: node.source?.value,
                specifiers: node.specifiers?.map((s: any) => ({
                  type: s.type,
                  local: s.local?.name,
                  imported: s.imported?.name,
                })),
              },
              null,
              2,
            ),
          );
        }

        // --- Case 1: mdxjsEsm (string-based) ---
        if (node.type === "mdxjsEsm") {
          const value = String(node.value || "");
          const lines = value.split("\n");

          const rewritten = lines.map((line) => {
            const out = rewriteImportOrExportLine(line, file.path);
            if (line !== out) {
              console.log(
                "🔧 mdxjsEsm line rewrite:",
                JSON.stringify(
                  {
                    file: file.path,
                    before: line,
                    after: out,
                  },
                  null,
                  2,
                ),
              );
            }
            return out;
          });

          node.value = rewritten.join("\n");
          return;
        }

        // --- Case 2: ESTree import/export nodes ---
        if (node.type === "import" || node.type === "export") {
          // ⭐ STRIP ALL EXPORTS (root cause)
          if (node.type === "export" && !node.source) {
            console.log("🔧 stripping ESTree export:", node);
            node.type = "mdxjsEsm";
            node.value = "// stripped export";
            delete node.specifiers;
            delete node.source;
            return;
          }

          const importPath = node.source?.value;
          if (!importPath) return;

          const resolved = joinPath(file.path, importPath);
          const isMedia = MEDIA_RE.test(resolved);

          console.log(
            "🔧 ESTree import/export rewrite:",
            JSON.stringify(
              {
                file: file.path,
                importPath,
                resolved,
                isMedia,
              },
              null,
              2,
            ),
          );

          if (isMedia) {
            const names =
              node.specifiers?.map((s: any) => s.local?.name).filter(Boolean) ??
              [];

            const decls = names
              .map(
                (name: string) =>
                  `const ${name} = "/api/docs/images/local?path=${encodeURIComponent(
                    resolved,
                  )}";`,
              )
              .join("\n");

            node.type = "mdxjsEsm";
            node.value = decls;
          } else {
            node.type = "mdxjsEsm";
            node.value = "// stripped non-media import";
          }

          delete node.source;
          delete node.specifiers;
        }
      },
    );
  };
}

// Rewrite a single import/export line inside an mdxjsEsm block
function rewriteImportOrExportLine(line: string, filePath: string): string {
  const trimmed = line.trim();

  // ⭐ STRIP ALL EXPORTS (root cause)
  if (trimmed.startsWith("export const")) {
    console.log("🔍 stripping export:", trimmed);
    return "// stripped export";
  }

  if (!trimmed.startsWith("import") && !trimmed.startsWith("export")) {
    return line;
  }

  const m = trimmed.match(
    /^(import|export)\s+(.+?)\s+from\s+['"](.*)['"]\s*;?\s*$/,
  );

  if (!m) {
    const side = trimmed.match(/^(import|export)\s+['"](.*)['"]\s*;?\s*$/);
    if (!side) return line;

    const importPath = side[2];
    const resolved = joinPath(filePath, importPath);
    const isMedia = MEDIA_RE.test(resolved);

    console.log(
      "🔍 side-effect import/export line:",
      JSON.stringify(
        {
          file: filePath,
          line,
          importPath,
          resolved,
          isMedia,
        },
        null,
        2,
      ),
    );

    if (!isMedia) return "// stripped non-media side-effect import";
    return "// media side-effect import ignored";
  }

  const [, , identifiers, importPath] = m;
  const resolved = joinPath(filePath, importPath);
  const isMedia = MEDIA_RE.test(resolved);

  console.log(
    "🔍 import/export line:",
    JSON.stringify(
      {
        file: filePath,
        line,
        identifiers,
        importPath,
        resolved,
        isMedia,
      },
      null,
      2,
    ),
  );

  if (!isMedia) return "// stripped non-media import";

  const names = extractNames(identifiers);
  if (!names.length) return "// media import with no bindings";

  const decls = names
    .map(
      (name) =>
        `const ${name} = "/api/docs/images/local?path=${encodeURIComponent(
          resolved,
        )}";`,
    )
    .join("\n");

  return decls;
}

function extractNames(identifiers: string): string[] {
  let ids = identifiers.trim();

  if (ids.startsWith("* as")) {
    return [ids.replace("* as", "").trim()];
  }

  if (ids.startsWith("{")) {
    return ids
      .replace(/[{}]/g, "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  if (ids.includes(",")) {
    return ids
      .split(",")
      .map((s) => s.replace(/[{}]/g, "").trim())
      .filter(Boolean);
  }

  return [ids];
}
