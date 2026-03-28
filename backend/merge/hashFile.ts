import crypto from "crypto";

export function hashBuffer(buf: Buffer) {
  return crypto.createHash("sha1").update(buf).digest("hex");
}

export async function hashFile(path: string) {
  const buf = await fs.readFile(path);
  return hashBuffer(buf);
}
