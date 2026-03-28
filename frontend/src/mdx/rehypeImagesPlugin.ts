import { visit } from "unist-util-visit";
import path from "path-browserify";

export default function rehypeImages(currentDocPath: string) {
  // Extract workspace name
  const match = currentDocPath.match(/^local-workspace\/([^/]+)\//);
  const workspace = match ? match[1] : null;

  // Directory containing the MDX file (e.g. local-workspace/ws/docs/)
  const docDir = currentDocPath.replace(/[^/]+$/, "");

  return (tree: any) => {
    visit(tree, "element", (node: any) => {
      if (!node.properties) return;

      const tag = node.tagName;
      if (tag !== "img" && tag !== "video") return;

      const props = node.properties;
      const src = props.src;
      if (!src || typeof src !== "string") return;

      // Skip URLs already rewritten
      if (src.startsWith("http://") || src.startsWith("https://")) return;
      if (src.startsWith("data:")) return;

      const login = localStorage.getItem("rf_login") || "";

      //
      // 1. Resolve relative to MDX file directory
      //
      const resolved = path
        .normalize(path.join(docDir, src))
        .replace(/\\/g, "/");

      //
      // 2. Build URL using URLSearchParams to avoid &amp; escaping
      //
      const params = new URLSearchParams({
        path: resolved,
        login,
        workspace: workspace || "",
      });

      props.src = `/api/docs/images/local?${params.toString()}`;
    });
  };
}
