import * as fs from "fs-extra";
import path from "path";
import { hashBuffer } from "./hashFile";

export async function applyUpstreamToWorkspace(
  workspace: string,
  baseDir: string,
  newDir: string,
  upstream,
) {
  const result = {
    updated: [],
    conflicts: [],
    skipped: [],
  };

  // ADDED
  for (const rel of upstream.added) {
    const wsPath = path.join(workspace, rel);
    const newPath = path.join(newDir, rel);

    if (!(await fs.pathExists(wsPath))) {
      await fs.ensureDir(path.dirname(wsPath));
      await fs.copy(newPath, wsPath);
      result.updated.push(rel);
    } else {
      result.skipped.push(rel);
    }
  }

  // MODIFIED
  for (const rel of upstream.modified) {
    const wsPath = path.join(workspace, rel);
    const basePath = path.join(baseDir, rel);
    const newPath = path.join(newDir, rel);

    const baseBuf = await fs.readFile(basePath);
    const newBuf = await fs.readFile(newPath);

    if (!(await fs.pathExists(wsPath))) {
      // Workspace deleted it → user wins
      result.skipped.push(rel);
      continue;
    }

    const wsBuf = await fs.readFile(wsPath);

    if (hashBuffer(wsBuf) === hashBuffer(baseBuf)) {
      // Workspace unchanged → update it
      await fs.copy(newPath, wsPath);
      result.updated.push(rel);
    } else {
      // Conflict
      const conflictPath = wsPath + ".conflict";
      await fs.writeFile(conflictPath, newBuf);
      result.conflicts.push(rel);
    }
  }

  // DELETED
  for (const rel of upstream.deleted) {
    const wsPath = path.join(workspace, rel);
    const basePath = path.join(baseDir, rel);

    if (!(await fs.pathExists(wsPath))) continue;

    const baseBuf = await fs.readFile(basePath);
    const wsBuf = await fs.readFile(wsPath);

    if (hashBuffer(wsBuf) === hashBuffer(baseBuf)) {
      await fs.remove(wsPath);
      result.updated.push(rel);
    } else {
      result.skipped.push(rel);
    }
  }

  return result;
}
