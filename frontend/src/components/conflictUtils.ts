/* frontend/src/components/conflictUtils.ts
 *
 * Description of responsibility:
 *   Tiny shared helpers for recognizing and stripping the ".conflict"
 *   suffix resetMirror.ts appends to a file when a rebase detects a
 *   real conflict between workspace edits and upstream changes.
 *
 * Info:
 *   Kept as one-line functions rather than inlined at each call site so
 *   the ".conflict" suffix convention only has to be spelled out once.
 */
export function isConflictFile(name: string) {
  return name.endsWith(".conflict");
}

export function baseFileName(conflictName: string) {
  return conflictName.replace(/\.conflict$/, "");
}
