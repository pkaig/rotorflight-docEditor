import { visit } from "unist-util-visit";
import path from "path-browserify";

export default function rehypeImages(currentDocPath: string) {
  return (tree: any) => {
    if (!tree || typeof tree !== "object") return;

    const docDir = currentDocPath.split("/").slice(0, -1).join("/");

    visit(tree, "element", (node: any) => {
      if (node.tagName !== "img") return;

      const props = node.properties;
      if (!props || typeof props !== "object") return;

      const src = props.src;
      if (typeof src !== "string" || !src) return;

      // 1. Skip backend URLs (critical)
      if (src.startsWith("/api/images")) {
        console.log("🟦 [rehypeImages] Skipping backend URL:", src);
        return;
      }

      // 2. Skip external URLs
      if (src.startsWith("http://") || src.startsWith("https://")) {
        console.log("🟦 [rehypeImages] Skipping external URL:", src);
        return;
      }

      // 3. Skip data URLs
      if (src.startsWith("data:")) {
        console.log("🟦 [rehypeImages] Skipping data URL");
        return;
      }

      // 4. Rewrite relative paths only
      const resolved = path.posix.join(docDir, src).replace(/\\/g, "/");

      console.log("🟥 [rehypeImages] Rewriting relative:", src, "→", resolved);

      props.src = `http://localhost:4000/api/images?path=${encodeURIComponent(resolved)}`;
    });
  };
}
