console.log("rehypeRewriteImageImports loaded");
import { visit } from "unist-util-visit";
import path from "path";

export default function rehypeImportedImages(tree, file) {
  console.log("rehypeImportedImages running");
  if (!file || typeof file.path !== "string") return;

  let currentDocPath;

  // Local workspace file
  if (file.path.includes("/local-workspace/")) {
    const after = file.path.split("/local-workspace/")[1];
    currentDocPath = "local-workspace/" + after;
  }

  // GitHub docs file
  else if (file.path.includes("/docs/")) {
    const after = file.path.split("/docs/")[1];
    currentDocPath = "docs/" + after;
  }

  // Fallback (should never happen)
  else {
    currentDocPath = file.path;
  }

  visit(tree, "mdxjsEsm", (node) => {
    console.log("MDX ESM NODE:", node);
    if (!node || typeof node.value !== "string") return;

    const match = node.value.match(
      /import\s+(\w+)\s+from\s+["'](.+\.(png|jpg|jpeg|gif|svg))["']/,
    );

    if (!match) return;

    const [, varName, importPath] = match;

    const resolved = path
      .join(path.dirname(currentDocPath), importPath)
      .replace(/\\/g, "/");

    const rewritten = `/api/images?path=${resolved}`;

    console.log("IMPORT REWRITE HIT:", { importPath, resolved, rewritten });

    node.value = `export const ${varName} = "${rewritten}";`;
  });
}
