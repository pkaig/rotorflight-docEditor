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
    const imports = new Map();

    // 1. Capture ALL imports and remove them
    visit(tree, "mdxjsEsm", (node, index, parent) => {
      if (!parent) return;

      const value = node.value.trim();

      // Match ANY import: import X from "..."
      const match = value.match(/^import\s+(\w+)\s+from\s+['"](.*)['"]/);

      if (match) {
        const [, identifier, importPath] = match;

        const resolved = joinPath(file.path, importPath);

        imports.set(identifier, resolved);

        parent.children.splice(index, 1);
      }
    });

    // 2. Rewrite references to imported identifiers
    visit(tree, (node) => {
      // <Component prop={IDENTIFIER}>
      if (node.type === "mdxJsxExpressionAttribute") {
        const id = node.value?.trim();
        if (imports.has(id)) {
          const resolved = imports.get(id);

          // Image import → rewrite to API URL
          if (/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(resolved)) {
            node.value = `"${`/api/docs/images/local?path=${encodeURIComponent(
              resolved,
            )}`}"`;
          } else {
            // Non-image import → replace with null
            node.value = "null";
          }
        }
      }

      // <Component IDENTIFIER={...}>
      if (node.type === "mdxJsxAttribute" && imports.has(node.value)) {
        const resolved = imports.get(node.value);

        if (/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(resolved)) {
          node.value = `/api/docs/images/local?path=${encodeURIComponent(resolved)}`;
        } else {
          node.value = null;
        }
      }
    });
  };
}
