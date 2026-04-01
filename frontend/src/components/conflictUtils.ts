// conflictUtils.ts
export function isConflictFile(name: string) {
  return name.endsWith(".conflict");
}

export function baseFileName(conflictName: string) {
  return conflictName.replace(/\.conflict$/, "");
}
