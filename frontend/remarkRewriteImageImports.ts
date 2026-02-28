import { visit } from "unist-util-visit";
import path from "path";

export function remarkRewriteImageImports(currentDocPath: string) {
  return (tree: any) => {
    const docDir = currentDocPath.split("/").slice(0, -1).join("/");

    visit(tree, "mdxjsEsm", (node: any) => {
      const code = node.value;

      const regex =
        /import\s+(\w+)\s+from\s+["'](.+?\.(png|jpg|jpeg|webp))["']/g;

      let match;
      let rewritten = code;

      while ((match = regex.exec(code)) !== null) {
        const [, varName, relPath] = match;

        const resolved = path.posix.join(docDir, relPath).replace(/\\/g, "/");

        const backendUrl = `http://localhost:4000/api/images?path=${encodeURIComponent(resolved)}`;

        rewritten = rewritten.replace(
          match[0],
          `const ${varName} = "${backendUrl}";`,
        );
      }

      node.value = rewritten;
    });
  };
}
