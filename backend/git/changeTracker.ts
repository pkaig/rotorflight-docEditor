// changeTracker.ts

export interface ChangeSet {
  added: Set<string>;
  modified: Set<string>;
  renamed: Map<string, string>;
  deleted: Set<string>;
}

const changeMap: Map<string, ChangeSet> = new Map();

function getOrCreate(slug: string): ChangeSet {
  if (!changeMap.has(slug)) {
    changeMap.set(slug, {
      added: new Set(),
      modified: new Set(),
      renamed: new Map(),
      deleted: new Set(),
    });
  }
  return changeMap.get(slug)!;
}

export function markAdded(slug: string, path: string) {
  const cs = getOrCreate(slug);
  cs.added.add(path);
}

export function markModified(slug: string, path: string) {
  const cs = getOrCreate(slug);
  cs.modified.add(path);
}

export function markRenamed(slug: string, oldPath: string, newPath: string) {
  const cs = getOrCreate(slug);
  cs.renamed.set(oldPath, newPath);
}

export function markDeleted(slug: string, path: string) {
  const cs = getOrCreate(slug);
  cs.deleted.add(path);
}

export function getChanges(slug: string): ChangeSet {
  return getOrCreate(slug);
}

export function clearChanges(slug: string) {
  changeMap.delete(slug);
}
