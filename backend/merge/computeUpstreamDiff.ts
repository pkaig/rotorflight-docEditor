import * as fs from "fs-extra";
import path from "path";
import { hashBuffer } from "./hashFile";

export async function computeUpstreamDiff(baseDir: string, newDir: string) {
  const diff = {
    added: [],
    modified: [],
    deleted: [],
  };

  async function walkBase(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const basePath = path.join(dir, entry.name);
      const rel = path.relative(baseDir, basePath);
      const newPath = path.join(newDir, rel);

      if (entry.isDirectory()) {
        await walkBase(basePath);
        continue;
      }

      const baseBuf = await fs.readFile(basePath);

      if (!(await fs.pathExists(newPath))) {
        diff.deleted.push(rel);
        continue;
      }

      const newBuf = await fs.readFile(newPath);

      if (hashBuffer(baseBuf) !== hashBuffer(newBuf)) {
        diff.modified.push(rel);
      }
    }
  }

  async function walkNew(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const newPath = path.join(dir, entry.name);
      const rel = path.relative(newDir, newPath);
      const basePath = path.join(baseDir, rel);

      if (entry.isDirectory()) {
        await walkNew(newPath);
        continue;
      }

      if (!(await fs.pathExists(basePath))) {
        diff.added.push(rel);
      }
    }
  }

  await walkBase(baseDir);
  await walkNew(newDir);

  return diff;
}
