export function isLocalPath(p: string) {
  return p?.startsWith("local-workspace/") || p?.startsWith("local/");
}

export function normalizeLocalPath(p: string) {
  return p?.replace(/^local-workspace\//, "").replace(/^local\//, "");
}
