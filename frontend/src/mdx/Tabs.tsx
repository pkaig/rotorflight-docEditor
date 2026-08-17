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
import React, { useState, Children, cloneElement } from "react";
import styles from "../css/tabs.module.css";

export default function Tabs({ children, groupId, defaultValue }) {
  const items = Children.toArray(children).filter(
    (child) => child.type && child.type.displayName === "TabItem",
  );

  const first = defaultValue || items[0]?.props.value;
  const [active, setActive] = useState(first);

  return (
    <div className={styles.tabsContainer}>
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
