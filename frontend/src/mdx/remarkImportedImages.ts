// remarkImportedImages.ts
import { visit } from "unist-util-visit";

function resolveImportPath(currentDocPath: string, relPath: string) {
  const baseDir = currentDocPath.replace(/[^/]+$/, "");

  if (relPath.startsWith("/")) {
    return relPath.replace(/^\//, "");
  }

  const combined = `${baseDir}${relPath}`;

  const parts = combined.split("/").reduce<string[]>((acc, part) => {
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
  return (tree: any, file: any) => {
    if (!file || typeof file.path !== "string") {
      return;
    }

    let currentDocPath: string;

    if (file.path.includes("/docs/")) {
      const after = file.path.split("/docs/")[1];
      currentDocPath = "docs/" + after;
    } else {
      currentDocPath = file.path;
    }

    visit(tree, "mdxjsEsm", (node: any) => {
      const estree = node.data?.estree;
      if (!estree || !Array.isArray(estree.body)) return;

      for (const stmt of estree.body) {
        if (stmt.type !== "ImportDeclaration") continue;

        const importPath = stmt.source?.value;
        const varName = stmt.specifiers?.[0]?.local?.name;

        if (!importPath || !varName) continue;

        // Only rewrite image imports
        if (!/\.(png|jpe?g|gif|svg|webp)$/i.test(importPath)) continue;

        const resolved = resolveImportPath(currentDocPath, importPath);

        const login =
          typeof window !== "undefined" ? localStorage.getItem("rf_login") : "";

        let rewritten: string;

        if (resolved.startsWith("local-workspace/")) {
          const clean = resolved.replace(/^local-workspace\//, "");
          rewritten = `/api/docs/images/local?path=${clean}&login=${encodeURIComponent(
            login || "",
          )}`;
        } else {
          rewritten = `/api/images?path=${resolved}&login=${encodeURIComponent(
            login || "",
          )}`;
        }

        // Rewrite node as an ESM export, preserving data/estree shape
        node.type = "mdxjsEsm";
        node.value = `export const ${varName} = "${rewritten}";`;

        node.data = node.data || {};
        node.data.estree = {
          type: "Program",
          sourceType: "module",
          body: [
            {
              type: "ExportNamedDeclaration",
              declaration: {
                type: "VariableDeclaration",
                kind: "const",
                declarations: [
                  {
                    type: "VariableDeclarator",
                    id: { type: "Identifier", name: varName },
                    init: { type: "Literal", value: rewritten },
                  },
                ],
              },
              specifiers: [],
              source: null,
            },
          ],
        };

        // We only expect one import per mdxjsEsm node for this use‑case
        break;
      }
    });
  };
}
