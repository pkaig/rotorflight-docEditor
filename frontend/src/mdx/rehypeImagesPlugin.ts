import { visit } from "unist-util-visit";

export default function rehypeImages(currentDocPath: string) {
  // Extract workspace name
  const match = currentDocPath.match(/^local-workspace\/([^/]+)\//);
  const workspace = match ? match[1] : null;

  // Directory containing the MDX file
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

      // Resolve relative to the MDX file directory
      const combined = `${docDir}${src}`;
      const resolved = combined.replace(/\/\.\//g, "/");

      // ALWAYS local now
      props.src =
        `/api/docs/images/local?path=${encodeURIComponent(resolved)}` +
        `&login=${encodeURIComponent(login)}` +
        `&workspace=${encodeURIComponent(workspace || "")}`;
    });
  };
}
