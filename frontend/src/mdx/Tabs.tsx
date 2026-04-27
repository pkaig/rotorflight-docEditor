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
