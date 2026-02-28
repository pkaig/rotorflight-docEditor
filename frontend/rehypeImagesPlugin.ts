import { visit } from "unist-util-visit";
import path from "path-browserify";

export default function rehypeImages(currentDocPath: string) {
  return (tree: any) => {
    if (!tree || typeof tree !== "object") return;

    // currentDocPath is something like: "docs/examples/index.md"
    // We want the folder: "docs/examples"
    const docDir = currentDocPath.split("/").slice(0, -1).join("/");

    visit(tree, "element", (node: any) => {
      if (node.tagName !== "img") return;

      const props = node.properties;
      if (!props || typeof props !== "object") return;

      const src = props.src;
      if (typeof src !== "string" || !src) return;

      // Skip absolute URLs
      if (src.startsWith("http://") || src.startsWith("https://")) return;

      // Resolve relative paths like "./img/foo.png"
      const resolved = path.posix.join(docDir, src).replace(/\\/g, "/");
      console.log("currentDocPath:", currentDocPath);
      console.log("resolved:", resolved);

      // Rewrite to backend image route
      props.src = `http://localhost:4000/api/images?path=${encodeURIComponent(resolved)}`;
    });
  };
}
