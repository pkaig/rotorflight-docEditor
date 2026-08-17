/* frontend/src/mdx/TabItem.tsx
 *
 * Description of responsibility:
 *   Minimal re-implementation of Docusaurus's @theme/TabItem for the
 *   in-browser preview sandbox — renders its children only when
 *   active, as set by the parent Tabs component.
 *
 * Info:
 *   displayName is set explicitly and matched by string in Tabs.tsx
 *   (Children.toArray().filter) rather than relying on real component
 *   identity — the preview evaluates compiled doc code in a sandboxed
 *   module scope where this and the real Docusaurus TabItem are never
 *   the same object reference.
 */
// TabItem.tsx
import React from "react";

export default function TabItem({ children, active }) {
  if (!active) return null;
  return <div>{children}</div>;
}

TabItem.displayName = "TabItem";
