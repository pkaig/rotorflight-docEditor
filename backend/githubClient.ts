// githubClient.ts
import fetch from "node-fetch";
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
