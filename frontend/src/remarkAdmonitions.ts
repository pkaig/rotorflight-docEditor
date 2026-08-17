/* frontend/src/remarkAdmonitions.ts
 *
 * Description of responsibility:
 *   Remark plugin that turns Docusaurus-style `:::note`/`:::warning`/etc.
 *   directive blocks (parsed by remark-directive into
 *   container/leaf/text directive nodes) into the actual HTML structure
 *   (admonition/admonition-<type> divs with a title bar) Docusaurus's
 *   real theme CSS expects, so admonitions render correctly in the
 *   in-browser preview.
 *
 * Info:
 *   Must run after remark-directive in the plugin pipeline (see
 *   Preview.tsx's commonPlugins ordering) — without it, ":::note"
 *   blocks are still plain text/paragraph nodes, not the directive node
 *   types this plugin looks for.
 */
// frontend/src/remarkAdmonitions.js

import { visit } from "unist-util-visit";

export default function remarkAdmonitions() {
  return (tree: any) => {
    visit(tree, (node: any) => {
      if (
        node.type === "containerDirective" ||
        node.type === "leafDirective" ||
        node.type === "textDirective"
      ) {
        const type = node.name; // info, warning, note, danger, tip
        if (!type) return;

        const data = node.data || (node.data = {});
        const title = node.attributes?.title || node.label || "";

        data.hName = "div";
        data.hProperties = {
          className: ["admonition", `admonition-${type}`],
        };

        const titleNode = title
          ? {
              type: "paragraph",
              data: {
                hName: "div",
                hProperties: { className: "admonition-title" },
              },
              children: [{ type: "text", value: title }],
            }
          : null;

        if (titleNode) {
          node.children.unshift(titleNode);
        }
      }
    });
  };
}
