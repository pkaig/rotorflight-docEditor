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
 */
import fetch, { type RequestInit } from "node-fetch";
import {
  GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET,
  GITHUB_OWNER,
  GITHUB_REPO,
} from "./config/github";

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
