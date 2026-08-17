/* backend/config/github.ts
 *
 * Description of responsibility:
 *   Centralizes the GitHub OAuth app credentials and the identity of the
 *   single upstream repo (rotorflight/rotorflight-docs) this whole app
 *   edits against. Every other backend file that needs to know "which
 *   repo" or "which OAuth app" imports these constants rather than
 *   hardcoding them again.
 *
 * Info:
 *   GITHUB_OWNER/GITHUB_REPO are intentionally hardcoded rather than read
 *   from .env — this app only ever targets one fixed upstream repo, so
 *   there's no real configuration to vary. The startup console.log block
 *   is a deliberate boot-time sanity check: a missing client id/secret
 *   would otherwise fail silently deep inside the OAuth device flow
 *   instead of at process start.
 */
export const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID!;
export const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET!;
export const GITHUB_OWNER = "rotorflight";
export const GITHUB_REPO = "rotorflight-docs";
export const GITHUB_DEFAULT_BRANCH = "main";

console.log("GitHub Config Loaded:");
console.log("GITHUB_CLIENT_ID:", GITHUB_CLIENT_ID ? "✅" : "❌");
console.log("GITHUB_CLIENT_SECRET:", GITHUB_CLIENT_SECRET ? "✅" : "❌");
console.log("GITHUB_OWNER:", GITHUB_OWNER ? "✅" : "❌");
console.log("GITHUB_REPO:", GITHUB_REPO ? "✅" : "❌");
console.log("GITHUB_DEFAULT_BRANCH:", GITHUB_DEFAULT_BRANCH ? "✅" : "❌");
