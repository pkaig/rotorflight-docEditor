const pathDebug = false;

export function isLocalPath(path: string) {
  if (pathDebug) console.log("isLocalPath?", path);
  return path?.startsWith("local-workspace/");
}

// Convert workspace-relative paths into canonical local-workspace paths
export function normaliseLocalPath(path: string, workspace: string) {
  if (pathDebug) console.log("normaliseLocalPath input:", path);
  if (!path) return "";

  // Already canonical
  if (path.startsWith("local-workspace/")) {
    return path;
  }

  // Workspace-relative → canonical
  return `local-workspace/${workspace}/${path}`;
}
