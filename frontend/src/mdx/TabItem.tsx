// TabItem.tsx
import React from "react";

export default function TabItem({ children, active }) {
  if (!active) return null;
  return <div>{children}</div>;
}

TabItem.displayName = "TabItem";
