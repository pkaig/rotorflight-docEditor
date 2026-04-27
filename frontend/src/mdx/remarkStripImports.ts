import { visit } from "unist-util-visit";

export default function remarkStripImports() {
  return (tree, file) => {
    visit(tree, "mdxjsEsm", (node, index, parent) => {
      if (!parent) return;

      // Remove ALL ESM import/export blocks
      if (
        node.value.startsWith("import ") ||
        node.value.startsWith("export ")
      ) {
        parent.children.splice(index, 1);
      }
    });
  };
}
