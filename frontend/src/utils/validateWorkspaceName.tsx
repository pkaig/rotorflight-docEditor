/* -------------------------------------------------------
     Validate the workspace name before allowing the user to create it.
  ------------------------------------------------------- */
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
