console.log("rehypeImagesPlugin loaded");

import { visit } from "unist-util-visit";

export default function rehypeImages(currentDocPath: string) {
  // e.g. "docs/setup/governor-flyrotor-setup.mdx" → "docs/setup/"
  const docDir = currentDocPath.replace(/[^/]+$/, "");

  return (tree: any) => {
    if (!tree || typeof tree !== "object") return;

    visit(tree, "element", (node: any) => {
      if (!node || !node.properties) return;

      const tag = node.tagName;
      if (tag !== "img" && tag !== "video") return; // ⭐ support both

      const props = node.properties as { [key: string]: any };
      const src = props.src;

      if (typeof src !== "string" || !src) return;

      // 1. Skip already‑rewritten backend URLs
      if (src.startsWith("http://localhost:4000/api/images")) {
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

      // 4. Treat everything else as doc‑relative
      //    e.g. "docs/setup/" + "./img/foo.png" → "docs/setup/./img/foo.png"
      const combined = `${docDir}${src}`;
      const resolved = combined.replace(/\/\.\//g, "/");

      console.log(`🟥 [rehypeImages] Rewriting relative: ${src} → ${resolved}`);

      props.src = `http://localhost:4000/api/images?path=${resolved}`;
    });
  };
}
