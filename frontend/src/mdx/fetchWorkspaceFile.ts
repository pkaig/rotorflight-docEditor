// /api/docs/images/local streams whatever file exists at the given
// workspace-relative path (res.sendFile, no content-type gatekeeping), so
// it doubles as a generic "read any workspace file" endpoint — used here
// for CSS/JSON/component source text, not just images.
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
