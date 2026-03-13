// prSession.ts

import fs from "fs";
import path from "path";
import { ChangeSet } from "./changeTracker";

export interface PRSession {
  branch: string;
  prNumber: number;
  status: "open" | "closed" | "merged";
  changes: ChangeSet;
}

const SESSION_DIR = path.join(process.cwd(), "pr-sessions");

export function loadSession(slug: string): PRSession | null {
  const file = path.join(SESSION_DIR, `${slug}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function saveSession(slug: string, session: PRSession) {
  if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR);
  const file = path.join(SESSION_DIR, `${slug}.json`);
  fs.writeFileSync(file, JSON.stringify(session, null, 2));
}

export function deleteSession(slug: string) {
  const file = path.join(SESSION_DIR, `${slug}.json`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

export function sessionExists(slug: string): boolean {
  const file = path.join(SESSION_DIR, `${slug}.json`);
  return fs.existsSync(file);
}
