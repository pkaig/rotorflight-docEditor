console.log("rehypeRewriteImageImports loaded");
import { visit } from "unist-util-visit";
import path from "path";

export default function rehypeImportedImages(tree, file) {
  console.log("rehypeImportedImages running");
  if (!file || typeof file.path !== "string") return;

  const currentDocPath = file.path.replace(/^.*\/docs\//, "docs/");

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
