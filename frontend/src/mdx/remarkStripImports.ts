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

    // 1. Collect and remove import statements
    visit(tree, "mdxjsEsm", (node, index, parent) => {
      if (!parent) return;

      const value = node.value.trim();

      const match = value.match(
        /^import\s+(\w+)\s+from\s+['"](.*\.(png|jpg|jpeg|gif|svg|webp))['"]/,
      );

      if (match) {
        const [, identifier, importPath] = match;

        const resolved = joinPath(file.path, importPath);

        imports.set(identifier, resolved);

        parent.children.splice(index, 1);
      }
    });

    // 2. Rewrite JSX attributes referencing the removed imports
    visit(tree, (node) => {
      // <img src={ETHOS}>
      if (node.type === "mdxJsxAttribute" && imports.has(node.value)) {
        const resolved = imports.get(node.value);
        node.value = `/api/docs/images/local?path=${encodeURIComponent(resolved)}`;
      }

      // <img src={ETHOS}>
      if (node.type === "mdxJsxExpressionAttribute") {
        const id = node.value?.trim();
        if (imports.has(id)) {
          const resolved = imports.get(id);
          node.value = `"${`/api/docs/images/local?path=${encodeURIComponent(
            resolved,
          )}`}"`;
        }
      }
    });
  };
}
