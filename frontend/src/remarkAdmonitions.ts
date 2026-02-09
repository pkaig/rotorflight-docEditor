import { visit } from "unist-util-visit";

export default function remarkAdmonitions() {
  return (tree: any) => {
    visit(tree, (node: any) => {
      if (node.type === "containerDirective") {
        const type = node.name; // info, warning, tip, danger, note

        node.data = {
          hName: "div",
          hProperties: {
            className: ["admonition", `admonition-${type}`],
          },
        };
      }
    });
  };
}
