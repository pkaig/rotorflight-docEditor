console.log("rehypeRewriteImageImports loaded");
import { visit } from "unist-util-visit";

function resolveImportPath(currentDocPath, relPath) {
  const baseDir = currentDocPath.replace(/[^/]+$/, "");

  if (relPath.startsWith("/")) {
    return relPath.replace(/^\//, "");
  }

  const combined = `${baseDir}${relPath}`;

  const parts = combined.split("/").reduce((acc, part) => {
    if (part === "" || part === ".") return acc;
    if (part === "..") {
      acc.pop();
      return acc;
    }
    acc.push(part);
    return acc;
  }, []);

  return parts.join("/");
}

export default function rehypeImportedImages() {
  return (tree, file) => {
    if (!file || typeof file.path !== "string") return;

    let currentDocPath;

    if (file.path.includes("/docs/")) {
      const after = file.path.split("/docs/")[1];
      currentDocPath = "docs/" + after;
    } else {
      currentDocPath = file.path;
    }

    visit(tree, "mdxjsEsm", (node) => {
      const estree = node.data?.estree;
      if (!estree || !Array.isArray(estree.body)) return;

      for (const stmt of estree.body) {
        if (stmt.type !== "ImportDeclaration") continue;

        const importPath = stmt.source?.value;
        const varName = stmt.specifiers?.[0]?.local?.name;

        if (!importPath || !varName) continue;

        const resolved = resolveImportPath(currentDocPath, importPath);

        const login =
          typeof window !== "undefined" ? localStorage.getItem("rf_login") : "";

        let rewritten;

        if (resolved.startsWith("local-workspace/")) {
          const clean = resolved.replace(/^local-workspace\//, "");
          rewritten = `/api/docs/images/local?path=${clean}&login=${encodeURIComponent(
            login,
          )}`;
        } else {
          rewritten = `/api/images?path=${resolved}&login=${encodeURIComponent(
            login,
          )}`;
        }

        node.value = `export const ${varName} = "${rewritten}";`;
      }
    });
  };
}
