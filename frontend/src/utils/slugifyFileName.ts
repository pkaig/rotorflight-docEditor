/* frontend/src/utils/slugifyFileName.ts
 *
 * Description of responsibility:
 *   Turns a user-entered name into a safe, Docusaurus-style lowercase-
 *   hyphenated filename segment. Shared by EditorPanel.tsx's "create new
 *   page" modal and AddImageModal.tsx's "add image" modal — both need
 *   the exact same name-cleaning rules, just append a different
 *   extension afterward (.mdx vs. whatever the image's real type is).
 *
 * Info:
 *   Matches spaces and underscores the same way so "My New Page"/
 *   "my_new_page" both become "my-new-page", then drops anything else
 *   that isn't safe in a path segment (also blocks "../" traversal via
 *   the leftover "." collapse) — the backend independently validates
 *   the final path too, but this keeps what the user sees in the
 *   preview matching what will actually be written.
 */
export function slugifyFileName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\.(mdx?|MDX?)$/, "")
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
