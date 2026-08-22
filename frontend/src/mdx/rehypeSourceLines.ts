/* frontend/src/mdx/rehypeSourceLines.ts
 *
 * Description of responsibility:
 *   Tags every rendered element with the source line it came from (a
 *   data-source-line attribute), so the rendered preview can be mapped
 *   back to a raw line number for things like the Move image tool's
 *   drop indicator — unified's parser already tracks this per-node as
 *   `position.start.line`; this just surfaces it into the DOM instead
 *   of leaving it discarded after compilation.
 *
 * Info:
 *   <Tabs> is a special case: unlike a plain HTML element (a hast
 *   "element" node with a `properties` object) or a remark-directive
 *   admonition (also compiled down to one), `<Tabs>` is authored as
 *   literal JSX and stays an mdxJsxFlowElement/mdxJsxTextElement node
 *   all the way through — those use an `attributes` array, not
 *   `properties`, so they need their own branch here. The tag only
 *   fires for Tabs specifically (by node.name), not every JSX element,
 *   since arbitrary components have no obligation to accept or forward
 *   an unknown prop the way Tabs.tsx has been deliberately updated to.
 */
import { visit } from "unist-util-visit";

export default function rehypeSourceLines() {
  return (tree: any) => {
    visit(tree, ["element", "mdxJsxFlowElement", "mdxJsxTextElement"], (node: any) => {
      const line = node.position?.start?.line;
      if (typeof line !== "number") return;

      if (node.type === "element" && node.properties) {
        node.properties["data-source-line"] = line;
        return;
      }

      if (node.name === "Tabs" && Array.isArray(node.attributes)) {
        node.attributes.push({
          type: "mdxJsxAttribute",
          name: "data-source-line",
          value: String(line),
        });
      }
    });
  };
}
