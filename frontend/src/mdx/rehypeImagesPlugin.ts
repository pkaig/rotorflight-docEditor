/* frontend/src/mdx/rehypeImagesPlugin.ts
 *
 * Description of responsibility:
 *   Rehype plugin that rewrites every <img>/<video> src in a compiled
 *   doc's HTML tree from a relative/workspace path into a real
 *   fetchable URL against /api/docs/images/local, so images render in
 *   the preview sandbox exactly as they would in the published site.
 *
 * Info:
 *   Leaves http(s):// and data: URLs untouched — only paths meant to
 *   resolve against the workspace get rewritten. Resolution is relative
 *   to the current doc's own directory (docDir), matching how
 *   Docusaurus resolves relative image paths in real docs.
 */
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

      const resolved = workspace
        ? `local-workspace/${workspace}/` +
          path
            .normalize(
              path.join(docDir.replace(/^local-workspace\/[^/]+\//, ""), src),
            )
            .replace(/\\/g, "/")
        : path.normalize(path.join(docDir, src)).replace(/\\/g, "/");

      const params = new URLSearchParams({
        path: resolved,
        login,
        workspace: workspace || "",
      });

      node.properties.src = `/api/docs/images/local?${params.toString()}`;
    });
  };
}
