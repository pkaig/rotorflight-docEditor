/* frontend/src/utils/validateWorkspaceName.tsx
 *
 * Description of responsibility:
 *   Validates a proposed workspace name against the naming rules the
 *   backend also enforces (lowercase, starts with a letter, no
 *   consecutive hyphens, not a reserved name) before WorkspaceSelector
 *   ever sends it to the server.
 *
 * Info:
 *   "mirror" and "rotorflight-docs" are reserved because those names
 *   collide with real directories the app itself creates under a
 *   workspace root (Rotorflight-docs/mirror, the global mirror clone)
 *   — letting a user create a workspace with either name would corrupt
 *   that app-owned state.
 */
export function validateWorkspaceName(name: string): string | null {
  // function validateWorkspaceName(name: string): string | null {
  if (!/^[a-z][a-z0-9-]{2,39}$/.test(name)) {
    return "Workspace name must start with a letter and contain only lowercase letters, numbers, and hyphens.";
  }

  if (/--/.test(name)) {
    return "Workspace name cannot contain consecutive hyphens.";
    console.log("Invalid workspace name (consecutive hyphens):", name);
  }

  if (name === "mirror" || name === "rotorflight-docs") {
    return `"${name}" is a reserved name and cannot be used.`;
    console.log("Reserved workspace name attempted:", name);
  }

  return null;
}
