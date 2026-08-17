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
 *   Every value here is hardcoded rather than read from .env — this app
 *   only ever targets one fixed upstream repo through one fixed GitHub
 *   App, so there's no real configuration to vary between installs, and
 *   the packaged desktop app (see electron/main.ts) doesn't ship an
 *   .env file at all. None of these values are sensitive: GITHUB_CLIENT_ID
 *   is a GitHub App's public client identifier, not a secret (unlike a
 *   classic OAuth App's client_secret, which this app deliberately
 *   avoids needing at all — see authRoutes.ts's device flow).
 */
export const GITHUB_CLIENT_ID = "Iv23liCxGT4tTeSRM4jT";
export const GITHUB_OWNER = "rotorflight";
export const GITHUB_REPO = "rotorflight-docs";
export const GITHUB_DEFAULT_BRANCH = "main";

console.log("GitHub Config Loaded:");
console.log("GITHUB_CLIENT_ID:", GITHUB_CLIENT_ID ? "✅" : "❌");
console.log("GITHUB_OWNER:", GITHUB_OWNER ? "✅" : "❌");
console.log("GITHUB_REPO:", GITHUB_REPO ? "✅" : "❌");
console.log("GITHUB_DEFAULT_BRANCH:", GITHUB_DEFAULT_BRANCH ? "✅" : "❌");
