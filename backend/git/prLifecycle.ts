// prLifecycle.ts

export interface PRStatus {
  state: "open" | "closed";
  merged: boolean;
  headSHA: string;
}

export async function createPR(branch: string, title: string, body: string) {
  // TODO: call GitHub API to create PR
  return { prNumber: 0, url: "" };
}

export async function updatePR(branch: string, prNumber: number) {
  // TODO: push new commits to existing PR branch
}

export async function getPRStatus(prNumber: number): Promise<PRStatus> {
  // TODO: call GitHub API to get PR status
  return { state: "open", merged: false, headSHA: "" };
}

export async function getPRHeadSHA(prNumber: number): Promise<string> {
  // TODO: return head SHA for detecting reviewer commits
  return "";
}
