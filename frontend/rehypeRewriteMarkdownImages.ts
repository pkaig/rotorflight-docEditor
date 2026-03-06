// rehypeRewriteMarkdownImages.ts
import { visit } from "unist-util-visit";

export default function rehypeRewriteMarkdownImages() {
  console.log("rehypeRewriteMarkdownImages loaded");
  return (tree) => {
    visit(tree, "element", (node) => {
      if (node.tagName !== "img") return;

      const props = node.properties || {};
      let src = props.src;
      if (!src || typeof src !== "string") return;

      // Normalize slashes
      src = src.replace(/\\/g, "/");

      // Strip prefixes that should not exist on disk
      const clean = src
        .replace(/^local-workspace\//, "")
        .replace(/^local\//, "");

      // Rewrite to correct backend endpoint
      props.src = `/api/images/local?path=${clean}`;

      node.properties = props;
    });
  };
}
