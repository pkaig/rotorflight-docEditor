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
        if (
          node.type === "table" ||
          node.type === "tableRow" ||
          node.type === "tableCell"
        ) {
          return true;
        }
        return node.type === "mdxjsEsm";
      },
      (node, index, parent) => {
        // Track table entry/exit
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

        // ⭐ Skip mdxjsEsm inside tables
        if (tableDepth > 0) {
          return;
        }

        // --- Normal mdxjsEsm import rewriting ---
        const value = String(node.value || "").trim();
        if (!value.startsWith("import ")) return;

        const match = value.match(/^import\s+(.+?)\s+from\s+['"](.*)['"]/);
        if (!match) return;

        const [, identifiers, importPath] = match;
        const resolved = joinPath(file.path, importPath);

        const names = [];

        if (identifiers.startsWith("{")) {
          identifiers
            .replace(/[{}]/g, "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .forEach((n) => names.push(n));
        } else if (identifiers.startsWith("*")) {
          const ns = identifiers.split("as")[1]?.trim();
          if (ns) names.push(ns);
        } else {
          names.push(identifiers.trim());
        }

        const isMedia = /\.(png|jpe?g|gif|svg|webp|mp4)$/i.test(resolved);

        const decls = names
          .map((name) =>
            isMedia
              ? `const ${name} = "/api/docs/images/local?path=${encodeURIComponent(resolved)}";`
              : `const ${name} = null;`,
          )
          .join("\n");

        node.value = decls;
      },
    );
  };
}
