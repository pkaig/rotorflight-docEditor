// frontend/src/remarkAdmonitions.js

import { visit } from "unist-util-visit";

export default function remarkAdmonitions() {
  return (tree) => {
    visit(tree, (node) => {
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
