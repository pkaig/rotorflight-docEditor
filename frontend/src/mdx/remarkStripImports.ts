import { visit } from "unist-util-visit";

// Browser-safe path resolver
function joinPath(base, relative) {
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

export default function remarkStripImports() {
  return (tree, file) => {
    if (!file.path.endsWith(".mdx")) return;

    let tableDepth = 0;

    visit(
      tree,
      (node) => {
        // Track table entry/exit
        if (
          node.type === "table" ||
          node.type === "tableRow" ||
          node.type === "tableCell"
        ) {
          return true;
        }

        // ⭐ Handle ALL import node types
        return (
          node.type === "mdxjsEsm" ||
          node.type === "import" ||
          node.type === "export"
        );
      },
      (node, index, parent) => {
        // Track table depth
        if (
          node.type === "table" ||
          node.type === "tableRow" ||
          node.type === "tableCell"
        ) {
          tableDepth++;
          return;
        }

        if (
          parent &&
          (parent.type === "table" ||
            parent.type === "tableRow" ||
            parent.type === "tableCell")
        ) {
          tableDepth++;
        }

        // ⭐ Skip imports inside tables
        if (tableDepth > 0) return;

        // --- Case 1: mdxjsEsm (string-based) ---
        if (node.type === "mdxjsEsm") {
          const value = String(node.value || "").trim();
          if (!value.startsWith("import ")) return;

          const match = value.match(/^import\s+(.+?)\s+from\s+['"](.*)['"]/);
          if (!match) return;

          const [, identifiers, importPath] = match;
          rewriteImport(node, identifiers, importPath, file);
          return;
        }

        // --- Case 2: import/export nodes (ESTree-based) ---
        if (node.type === "import" || node.type === "export") {
          const importPath = node.source?.value;
          if (!importPath) return;

          const identifiers = node.specifiers
            ?.map((s) => s.local?.name)
            .filter(Boolean)
            .join(", ");

          if (!identifiers) return;

          rewriteImport(node, identifiers, importPath, file);
        }
      },
    );
  };
}

// ⭐ Shared import rewriting logic
function rewriteImport(node, identifiers, importPath, file) {
  const resolved = joinPath(file.path, importPath);

  const names = identifiers
    .replace(/[{}]/g, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const isMedia = /\.(png|jpe?g|gif|svg|webp|mp4)$/i.test(resolved);

  const decls = names
    .map((name) =>
      isMedia
        ? `const ${name} = "/api/docs/images/local?path=${encodeURIComponent(
            resolved,
          )}";`
        : `const ${name} = null;`,
    )
    .join("\n");

  // Force mdxjsEsm output
  node.type = "mdxjsEsm";
  node.value = decls;

  // Remove ESTree fields if present
  delete node.source;
  delete node.specifiers;
}
