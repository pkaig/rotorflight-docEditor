/* frontend/src/mdx/Tabs.tsx
 *
 * Description of responsibility:
 *   Minimal re-implementation of Docusaurus's @theme/Tabs for the
 *   in-browser preview sandbox — renders a tab header row plus the
 *   active TabItem's content.
 *
 * Info:
 *   Filters children by `child.type.displayName === "TabItem"` rather
 *   than an instanceof/import check, matching how TabItem.tsx
 *   identifies itself — see the note there on why identity checks work
 *   this way in the sandboxed preview. Preview.tsx injects this
 *   component (and TabItem) into evaluated MDX by name as runtime
 *   globals; remarkStripImports.ts drops `import ... from "@theme/Tabs"`
 *   statements rather than resolving them, since there's nothing to
 *   fetch for a Docusaurus theme internal.
 */
// tabs.tsx
import { useState, Children, cloneElement } from "react";
import type { ReactElement, ReactNode } from "react";
import styles from "../css/tabs.module.css";

interface TabItemElementProps {
  value: string;
  label?: string;
  active?: boolean;
  children?: ReactNode;
}

function isTabItemElement(
  node: ReactNode,
): node is ReactElement<TabItemElementProps> {
  if (typeof node !== "object" || node === null || !("type" in node)) {
    return false;
  }
  const type = (node as ReactElement).type;
  return (
    typeof type === "function" &&
    (type as { displayName?: string }).displayName === "TabItem"
  );
}

interface TabsProps {
  children?: ReactNode;
  // Accepted for API compatibility with real Docusaurus tabs (which sync
  // active tab across every <Tabs> sharing a groupId) but not wired up in
  // this preview-sandbox re-implementation.
  groupId?: string;
  defaultValue?: string;
  // Injected by rehypeSourceLines.ts (only for <Tabs>, by name) so the
  // Tabs toolbar's Modify/Remove can map a click back to this block's
  // raw source line — forwarded onto the root div below rather than
  // just accepted and dropped, unlike every other unknown prop here.
  "data-source-line"?: string;
}

export default function Tabs({
  children,
  defaultValue,
  "data-source-line": dataSourceLine,
}: TabsProps) {
  const items = Children.toArray(children).filter(isTabItemElement);

  const first = defaultValue || items[0]?.props.value;
  const [active, setActive] = useState(first);

  return (
    <div
      className={styles.tabsContainer}
      data-source-line={dataSourceLine}
      data-rf-tabs="true"
    >
      <div className={styles.tabHeader}>
        {items.map((item) => (
          <button
            key={item.props.value}
            className={
              item.props.value === active ? styles.tabActive : styles.tab
            }
            onClick={() => setActive(item.props.value)}
          >
            {item.props.label}
          </button>
        ))}
      </div>

      <div className={styles.tabBody}>
        {items.map((item) =>
          cloneElement(item, { active: item.props.value === active }),
        )}
      </div>
    </div>
  );
}
