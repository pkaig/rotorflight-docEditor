console.log("rehypeImagesPlugin loaded");

import { visit } from "unist-util-visit";

export default function rehypeImages(currentDocPath: string) {
  // e.g. "docs/setup/governor-flyrotor-setup.mdx" → "docs/setup/"
  const docDir = currentDocPath.replace(/[^/]+$/, "");
  const isLocal = currentDocPath.startsWith("local/");

  return (tree: any) => {
    if (!tree || typeof tree !== "object") return;

    visit(tree, "element", (node: any) => {
      if (!node || !node.properties) return;

      const tag = node.tagName;
      if (tag !== "img" && tag !== "video") return;

      const props = node.properties as { [key: string]: any };
      const src = props.src;

      if (typeof src !== "string" || !src) return;

      // 1. Skip already‑rewritten backend URLs
      if (src.startsWith("http://localhost:4000/api/images")) {
        return;
      }

      // 2. Skip external URLs
      if (src.startsWith("http://") || src.startsWith("https://")) {
        return;
      }

      // 3. Skip data URLs
      if (src.startsWith("data:")) {
        return;
      }

      // 4. Treat everything else as doc‑relative
      const cleanDocDir = docDir.replace(/^local\//, "");
      const combined = `${cleanDocDir}${src}`;
      const resolved = combined.replace(/\/\.\//g, "/");

      console.log(`🟥 [rehypeImages] Rewriting relative: ${src} → ${resolved}`);

      if (isLocal) {
        // LOCAL WORKSPACE IMAGE: strip local/ and docs/
        const clean = resolved.replace(/^local\//, "").replace(/^docs\//, "");
        props.src = `http://localhost:4000/api/images/local?path=${clean}`;
      } else {
        // GITHUB IMAGE: keep docs/ and go through cache
        props.src = `http://localhost:4000/api/images?path=${resolved}`;
      }
    });
  };
}
