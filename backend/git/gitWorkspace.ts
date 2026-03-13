// gitWorkspace.ts

import { ChangeSet } from "./changeTracker";

export async function createBranch(branch: string) {
  // TODO: implement git branch creation
}

export async function commitChanges(branch: string, changes: ChangeSet) {
  // TODO: commit added/modified/renamed/deleted files
}

export async function pushBranch(branch: string) {
  // TODO: push branch to GitHub
}

export function deleteLocalFile(path: string) {
  // TODO: remove file from local workspace
}

export function resetWorkspaceForSlug(slug: string, changes: ChangeSet) {
  for (const file of changes.added) deleteLocalFile(file);
  for (const file of changes.modified) deleteLocalFile(file);
  for (const [, newPath] of changes.renamed) deleteLocalFile(newPath);
}
