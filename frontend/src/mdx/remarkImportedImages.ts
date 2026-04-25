// remarkImportedImages.ts
console.log("remarkImportedImages loaded");
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

export default function remarkImportedImages() {
  return (tree, file) => {
    console.log("🟪 PLUGIN ENTERED");

    if (!file || typeof file.path !== "string") {
      console.log("❌ PLUGIN EXIT: file.path missing or invalid", file);
      return;
    }

    console.log("🟪 PLUGIN FILE PATH:", file.path);

    let currentDocPath;

    if (file.path.includes("/docs/")) {
      const after = file.path.split("/docs/")[1];
      currentDocPath = "docs/" + after;
    } else {
      currentDocPath = file.path;
    }

    console.log("🟪 CURRENT DOC PATH:", currentDocPath);

    // 🔍 Log all mdxjsEsm nodes BEFORE filtering
    let esmCount = 0;
    visit(tree, "mdxjsEsm", (node) => {
      console.log("🟦 FOUND mdxjsEsm NODE:", node);
      esmCount++;
    });
    console.log("🟦 TOTAL mdxjsEsm NODES:", esmCount);

    // 🔍 Now run the actual visitor
    visit(tree, "mdxjsEsm", (node) => {
      console.log("🟩 VISITOR HIT mdxjsEsm");

      const estree = node.data?.estree;
      if (!estree) {
        console.log("❌ NO ESTREE ON NODE:", node);
        return;
      }

      console.log("🟩 ESTREE FOUND:", estree);

      if (!Array.isArray(estree.body)) {
        console.log("❌ ESTREE BODY NOT ARRAY:", estree.body);
        return;
      }

      for (const stmt of estree.body) {
        console.log("🟧 ESTREE STMT:", stmt);

        if (stmt.type !== "ImportDeclaration") {
          console.log("➡️ SKIP NON-IMPORT STMT");
          continue;
        }

        console.log("🟥 IMPORT DECLARATION FOUND:", stmt);

        const importPath = stmt.source?.value;
        const varName = stmt.specifiers?.[0]?.local?.name;

        console.log("🟥 IMPORT PATH:", importPath, "VAR:", varName);

        if (!importPath || !varName) {
          console.log("❌ MISSING importPath or varName");
          continue;
        }

        // ⭐ Only rewrite image imports
        if (!/\.(png|jpe?g|gif|svg|webp)$/i.test(importPath)) {
          console.log("➡️ SKIP NON-IMAGE IMPORT:", importPath);
          continue;
        }

        const resolved = resolveImportPath(currentDocPath, importPath);
        console.log("🟨 RESOLVED PATH:", resolved);

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

        console.log("🟩 REWRITING IMPORT:", varName, "→", rewritten);

        node.value = `export const ${varName} = "${rewritten}";`;
      }
    });
  };
}
