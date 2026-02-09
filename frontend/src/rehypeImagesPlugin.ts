import { visit } from "unist-util-visit";
import path from "path-browserify";

console.log("rehypeImages export:", rehypeImages);

export default function rehypeImages(currentDocPath: string) {
  console.log("rehypeImages registered as:", rehypeImages.name);

  return (tree: any, file: any) => {
    // Hard guard: never run if tree is missing
    if (!tree || typeof tree !== "object") {
      console.warn("rehypeImages: received invalid tree", tree);
      return;
    }

    const docDir = currentDocPath.split("/").slice(0, -1).join("/");

    visit(tree, "element", (node: any) => {
      if (node.tagName !== "img") return;

      const props = node.properties as any;
      if (!props || typeof props !== "object") return;

      const src = props.src;
      if (typeof src !== "string" || !src) return;

      if (src.startsWith("http://") || src.startsWith("https://")) return;

      const resolved = path.join(docDir, src).replace(/\\/g, "/");

      props.src =
        "http://localhost:4000/api/docs/image?path=" +
        encodeURIComponent(resolved);
    });
  };
}
