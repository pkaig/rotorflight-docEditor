// config/github.ts
export const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID!;
export const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET!;
export const GITHUB_OWNER = process.env.GITHUB_OWNER!;
export const GITHUB_REPO = process.env.GITHUB_REPO!;
export const GITHUB_DEFAULT_BRANCH = process.env.GITHUB_DEFAULT_BRANCH!;

console.log("GitHub Config Loaded:");
console.log("GITHUB_CLIENT_ID:", GITHUB_CLIENT_ID ? "✅" : "❌");
console.log("GITHUB_CLIENT_SECRET:", GITHUB_CLIENT_SECRET ? "✅" : "❌");
console.log("GITHUB_OWNER:", GITHUB_OWNER ? "✅" : "❌");
console.log("GITHUB_REPO:", GITHUB_REPO ? "✅" : "❌");
console.log("GITHUB_DEFAULT_BRANCH:", GITHUB_DEFAULT_BRANCH ? "✅" : "❌");
