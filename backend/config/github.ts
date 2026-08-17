/* backend/config/github.ts
 *
 * Description of responsibility:
 *   Centralizes the GitHub App's client ID and the identity of the single
 *   upstream repo (rotorflight/rotorflight-docs) this whole app edits
 *   against. Every other backend file that needs to know "which repo" or
 *   "which GitHub App" imports these constants rather than hardcoding
 *   them again.
 *
 * Info:
 *   GITHUB_OWNER/GITHUB_REPO are intentionally hardcoded rather than read
 *   from .env — this app only ever targets one fixed upstream repo, so
 *   there's no real configuration to vary. The startup console.log block
 *   is a deliberate boot-time sanity check: a missing client id would
 *   otherwise fail silently deep inside the device flow instead of at
 *   process start. There is deliberately no client secret here — this
 *   app is registered as a GitHub App (not a classic OAuth App)
 *   specifically so its device-flow token exchange needs no secret,
 *   since it's meant to run as software users download and run
 *   themselves, where a bundled secret couldn't stay secret.
 */
export const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID!;
export const GITHUB_OWNER = "rotorflight";
export const GITHUB_REPO = "rotorflight-docs";
export const GITHUB_DEFAULT_BRANCH = "main";

console.log("GitHub Config Loaded:");
console.log("GITHUB_CLIENT_ID:", GITHUB_CLIENT_ID ? "✅" : "❌");
console.log("GITHUB_OWNER:", GITHUB_OWNER ? "✅" : "❌");
console.log("GITHUB_REPO:", GITHUB_REPO ? "✅" : "❌");
console.log("GITHUB_DEFAULT_BRANCH:", GITHUB_DEFAULT_BRANCH ? "✅" : "❌");
