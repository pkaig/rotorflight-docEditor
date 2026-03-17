const pathDebug = true;

export function isLocalPath(path: string) {
  if (pathDebug) console.log("isLocalPath?", path);
  return path?.startsWith("local-workspace/");
}

//
export function normaliseLocalPath(path: string) {
  if (pathDebug) console.log("normaliseLocalPath input:", path);
  if (!path) return "";

  // 1. GitHub doc → DO NOT normalise
  if (path.startsWith("Rotorflight-docs/")) {
    if (pathDebug) console.log("Starts with Rotorflight-docs:", path);
    return path;
  }

  // 2. Already-local → DO NOT normalise
  if (path.startsWith("local-workspace/")) {
    if (pathDebug) console.log("Starts with local-workspace:", path);
    return path;
  }

  // 3. Local docs from tree walker
  if (path.startsWith("docs/")) {
    if (pathDebug) console.log("Starts with docs:", path);
    return `local-workspace/${path}`;
  }

  // 4. Unknown → pass through
  if (pathDebug) console.log("Unknown path format:", path);
  return path;
}
