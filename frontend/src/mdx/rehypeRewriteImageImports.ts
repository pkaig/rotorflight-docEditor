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
    console.log("Detected local workspace file:", currentDocPath);
  }

  // GitHub docs file
  else if (file.path.includes("/Rotorflight-docs/")) {
    const after = file.path.split("/Rotorflight-docs/")[1];
    currentDocPath = "Rotorflight-docs/" + after;
  }

  // Fallback
  else {
    currentDocPath = file.path;
  }

  visit(tree, "mdxjsEsm", (node) => {
    if (!node || typeof node.value !== "string") return;

    const match = node.value.match(
      /import\s+(\w+)\s+from\s+["'](.+\.(png|jpg|jpeg|gif|svg))["']/,
    );

    if (!match) return;

    const [, varName, importPath] = match;

    const resolved = path
      .join(path.dirname(currentDocPath), importPath)
      .replace(/\\/g, "/");

    const login =
      typeof window !== "undefined" ? localStorage.getItem("rf_login") : "";

    let rewritten;

    if (resolved.startsWith("local-workspace/")) {
      // LOCAL WORKSPACE
      const clean = resolved.replace(/^local-workspace\//, "");
      rewritten = `/api/docs/images/local?path=${clean}&login=${encodeURIComponent(login)}`;
      console.log("Resolved local workspace image:", {
        resolved,
        clean,
        rewritten,
      });
    } else {
      // GITHUB
      rewritten = `/api/docs/image?path=${resolved}&login=${encodeURIComponent(login)}`;
    }

    console.log("IMPORT REWRITE HIT:", { importPath, resolved, rewritten });

    node.value = `export const ${varName} = "${rewritten}";`;
  });
}
