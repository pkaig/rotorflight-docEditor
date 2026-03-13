import { visit } from "unist-util-visit";

export default function rehypeImages(currentDocPath: string) {
  // Determine if this is a local workspace file
  const isLocal = currentDocPath.startsWith("local-workspace/");

  // Directory containing the MDX file
  // e.g. "Rotorflight-docs/docs/setup/foo.mdx" → "Rotorflight-docs/docs/setup/"
  // e.g. "local-workspace/docs/setup/foo.mdx" → "local-workspace/docs/setup/"
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

      // Resolve relative to the MDX file directory
      const combined = `${docDir}${src}`;
      const resolved = combined.replace(/\/\.\//g, "/");
      const login = localStorage.getItem("rf_login");
      if (isLocal) {
        // LOCAL WORKSPACE
        // Strip "local-workspace/" prefix so backend receives "docs/.../img/foo.png"
        //const clean = resolved.replace(/^local-workspace\//, "");

        //props.src = `/api/docs/images/local?path=${clean}&login=${encodeURIComponent(login)}`;
        props.src = `/api/docs/images/local?path=${resolved}&login=${encodeURIComponent(login)}`;
      } else {
        // GITHUB
        // Preserve full path including Rotorflight-docs and version folders

        props.src = `/api/docs/image?path=${resolved}&login=${encodeURIComponent(login)}`;
      }
    });
  };
}
