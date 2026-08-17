/* frontend/src/utils/paths.ts
 *
 * Description of responsibility:
 *   Small helpers for recognizing and building the app's canonical
 *   "local-workspace/<workspace>/..." virtual path format used
 *   throughout the sidebar tree and editor state.
 *
 * Info:
 *   pathDebug is a manual on/off switch for verbose console logging
 *   during path-related debugging — left in as false rather than
 *   removed since it's been useful more than once when workspace-path
 *   bugs come up again.
 */
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
