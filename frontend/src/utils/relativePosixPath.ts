// Computes a relative path between two forward-slash-delimited virtual
// paths (workspace-relative doc/image paths — never real OS paths, so
// no drive letters or backslashes to worry about). Deliberately not
// path-browserify's own .relative(): that internally calls
// process.cwd(), which doesn't exist in a browser/Vite context and
// throws "process is not defined" the moment it's actually called
// (path-browserify's .normalize()/.join(), used elsewhere in this app,
// don't hit that code path, which is why this went unnoticed until
// .relative() specifically was tried).
export function relativePosixPath(fromDir: string, toPath: string): string {
  const fromParts =
    fromDir === "." || fromDir === "" ? [] : fromDir.split("/").filter(Boolean);
  const toParts = toPath.split("/").filter(Boolean);

  let i = 0;
  while (
    i < fromParts.length &&
    i < toParts.length &&
    fromParts[i] === toParts[i]
  ) {
    i++;
  }

  const ups = fromParts.length - i;
  const downs = toParts.slice(i);
  const relParts = [...Array(ups).fill(".."), ...downs];

  return relParts.length > 0 ? relParts.join("/") : ".";
}
