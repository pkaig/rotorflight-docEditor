/* frontend/src/mdx/fetchWorkspaceFile.ts
 *
 * Description of responsibility:
 *   Builds the URL for, and fetches the text of, any file inside a
 *   workspace via the backend's /api/docs/images/local endpoint — used
 *   by loadSiteModule.ts to pull in CSS/JSON/component source that an
 *   MDX doc imports, not just images.
 *
 * Info:
 *   /api/docs/images/local streams whatever file exists at the given
 *   workspace-relative path with no content-type gatekeeping
 *   (res.sendFile), which is exactly why it can double as this generic
 *   "read any workspace file" endpoint instead of needing a second
 *   dedicated route.
 */
export function workspaceFileUrl(
  resolvedPath: string,
  login: string,
  workspace: string,
): string {
  const params = new URLSearchParams({ path: resolvedPath, login, workspace });
  return `/api/docs/images/local?${params.toString()}`;
}

export async function fetchWorkspaceText(
  resolvedPath: string,
  login: string,
  workspace: string,
): Promise<string> {
  const res = await fetch(workspaceFileUrl(resolvedPath, login, workspace));
  if (!res.ok) {
    throw new Error(`Failed to load "${resolvedPath}" (${res.status})`);
  }
  return res.text();
}
