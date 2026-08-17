/* backend/githubClient.ts
 *
 * Description of responsibility:
 *   Thin wrapper around the GitHub REST API: attaches the bearer token
 *   and required headers, and turns a non-2xx response into a thrown
 *   Error instead of leaving every caller to check res.ok itself.
 *
 * Info:
 *   Every authenticated GitHub call in the backend (ensureFork,
 *   authRoutes, docsRoutes) goes through this one function, so a change
 *   to auth headers or error handling only has to happen here. Note
 *   gitRoutes.ts and resetMirror.ts each define their own separate
 *   GitHub request helper rather than importing this one.
 *
 *   Uses the global fetch/RequestInit (built into Node 18+, ambient via
 *   @types/node — no import needed) rather than the node-fetch package:
 *   node-fetch v3 is ESM-only, and require()-ing an ESM package from
 *   this file's compiled CommonJS output throws ERR_REQUIRE_ESM on any
 *   Node runtime without require(esm) support — which includes the
 *   older Node Electron bundles internally, even though it happened to
 *   work under this project's own (much newer) dev-time Node version.
 */

export type GitHubToken = string;

export async function githubRequest<T>(
  token: GitHubToken,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("GitHub API error:", res.status, text);
    throw new Error(`GitHub API ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}
