#!/usr/bin/env node
/**
 * Bump `@supportly/sdk` semver, sync `src/version.ts`, stub CHANGELOG.
 *
 * Usage (from sdks/):
 *   node scripts/bump.mjs patch|minor|major
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const kind = process.argv[2];

if (!["patch", "minor", "major"].includes(kind)) {
  console.error("usage: node scripts/bump.mjs <patch|minor|major>");
  process.exit(1);
}

const pkgPath = join(root, "typescript/package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const parts = String(pkg.version)
  .split(".")
  .map((n) => Number.parseInt(n, 10));
if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
  console.error(`invalid version in package.json: ${pkg.version}`);
  process.exit(1);
}
const [maj, min, pat] = parts;
const next =
  kind === "major" ? `${maj + 1}.0.0` : kind === "minor" ? `${maj}.${min + 1}.0` : `${maj}.${min}.${pat + 1}`;

pkg.version = next;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

writeFileSync(
  join(root, "typescript/src/version.ts"),
  `/** Semver пакета \`@supportly/sdk\`. Меняется скриптом \`scripts/bump.mjs\`. */\nexport const VERSION = "${next}";\n`,
);

const changelogPath = join(root, "typescript/CHANGELOG.md");
let changelog = readFileSync(changelogPath, "utf8");
const heading = `## ${next} — `;
if (!changelog.includes(heading)) {
  const date = new Date().toISOString().slice(0, 10);
  if (!changelog.startsWith("# Changelog\n")) {
    console.error("CHANGELOG.md must start with '# Changelog'");
    process.exit(1);
  }
  changelog = changelog.replace("# Changelog\n", `# Changelog\n\n## ${next} — ${date}\n\n- \n`);
  writeFileSync(changelogPath, changelog);
}

console.log(`Bumped @supportly/sdk to ${next}`);
console.log("");
console.log("Next:");
console.log(`  1. Fill in typescript/CHANGELOG.md for ${next}`);
console.log("  2. git add -A");
console.log(`  3. git commit -m "release: v${next}"`);
console.log(`  4. git tag v${next}`);
console.log("  5. git push origin main --tags");
console.log("");
console.log("Pushing the tag runs .github/workflows/publish.yml → npm.");

try {
  execSync("git diff --stat", { cwd: root, stdio: "inherit" });
} catch {
  // not a git repo yet
}
