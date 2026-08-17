// safePath.ts
//
// Every route in this app builds filesystem paths by joining a trusted
// base directory (workspaces/<session-login>/...) with values that come
// straight from the request — workspace names, file paths, folder names.
// path.join() does NOT stop ".." segments from walking back out of that
// base, so without validating those values first, an authenticated user
// could read or write files well outside their own workspace (other
// users' data, or anything else the Node process can reach) just by
// sending e.g. workspace="../otheruser" or path="../../../etc/hosts".
//
// The fix lives here rather than at each of the ~40 path.join() call
// sites: reject anything unsafe once, right after it's read off the
// request, before it ever reaches a path.join call.

// A single path segment with no separators at all — workspace names,
// folder names. Must not be ".", "..", empty, or contain a separator.
export function isSafePathSegment(segment: unknown): segment is string {
  if (typeof segment !== "string" || segment.length === 0) return false;
  if (segment.includes("\0")) return false;
  if (segment === "." || segment === "..") return false;
  if (segment.includes("/") || segment.includes("\\")) return false;
  return true;
}

// A relative path that's allowed to contain subdirectories (e.g.
// "docs/setup/img/foo.png") but must still not escape upward and must
// still not be absolute.
export function isSafeRelativePath(rel: unknown): rel is string {
  if (typeof rel !== "string" || rel.length === 0) return false;
  if (rel.includes("\0")) return false;

  const normalized = rel.replace(/\\/g, "/");
  if (normalized.startsWith("/")) return false; // POSIX absolute
  if (/^[a-zA-Z]:/.test(normalized)) return false; // Windows drive-absolute

  const parts = normalized.split("/");
  return parts.every((p) => p !== "..");
}
