import { visit } from "unist-util-visit";
import path from "path-browserify";

export default function rehypeImages(currentDocPath: string) {
  const match = currentDocPath.match(/^local-workspace\/([^/]+)\//);
  const workspace = match ? match[1] : null;

  const docDir = currentDocPath.replace(/[^/]+$/, "");

  return (tree: any) => {
    visit(tree, "element", (node: any) => {
      if (!node.properties) return;

      const tag = node.tagName;
      if (tag !== "img" && tag !== "video") return;

      const src = node.properties.src;

      // ⭐ Critical guard — prevents ALL crashes
      if (typeof src !== "string") return;

      if (src.startsWith("http://") || src.startsWith("https://")) return;
      if (src.startsWith("data:")) return;

      const login = localStorage.getItem("rf_login") || "";

      const resolved = path
        .normalize(path.join(docDir, src))
        .replace(/\\/g, "/");

      const params = new URLSearchParams({
        path: resolved,
        login,
        workspace: workspace || "",
      });

      node.properties.src = `/api/docs/images/local?${params.toString()}`;
    });
  };
}
