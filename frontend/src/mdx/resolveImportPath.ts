/* frontend/src/mdx/resolveImportPath.ts
 *
 * Description of responsibility:
 *   Resolves Docusaurus-style import specifiers (relative paths and
 *   the `@site/` site-root alias) to a workspace-relative path in the
 *   form "local-workspace/<workspace>/...", which is what the
 *   backend's /api/docs/images/local endpoint (reused as a generic
 *   "serve any workspace file" endpoint) expects.
 *
 * Info:
 *   joinPath() is a small hand-rolled path resolver rather than Node's
 *   `path` module, since there's no Node path module available in the
 *   browser preview sandbox.
 */

// Browser-safe path resolver (no Node "path" module available in-browser)
function joinPath(base: string, relative: string): string {
  if (relative.startsWith("/")) return relative;

  const baseParts = base.split("/").slice(0, -1);
  const relParts = relative.split("/");

  for (const part of relParts) {
    if (part === "." || part === "") continue;
    if (part === "..") baseParts.pop();
    else baseParts.push(part);
  }

  return baseParts.join("/");
}

export function resolveImportPath(
  fromPath: string,
  importPath: string,
  workspace: string,
): string {
  if (importPath.startsWith("@site/")) {
    return `local-workspace/${workspace}/${importPath.slice("@site/".length)}`;
  }
  return joinPath(fromPath, importPath);
}

export const MEDIA_RE = /\.(png|jpe?g|gif|svg|webp|mp4)$/i;
export const JSON_RE = /\.json$/i;
export const CSS_RE = /\.css$/i;
