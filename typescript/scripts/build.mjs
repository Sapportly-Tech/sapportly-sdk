import { build } from "esbuild";
import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "src");
const distDir = join(root, "dist");

const entries = {
  index: join(srcDir, "index.ts"),
  webhooks: join(srcDir, "webhooks.ts"),
  "realtime-entry": join(srcDir, "realtime-entry.ts"),
};

rmSync(distDir, { recursive: true, force: true });

for (const [name, entry] of Object.entries(entries)) {
  for (const [format, extension] of [
    ["esm", "js"],
    ["cjs", "cjs"],
  ]) {
    await build({
      entryPoints: [entry],
      outfile: join(distDir, `${name}.${extension}`),
      format,
      bundle: true,
      // "neutral" keeps Node built-ins out of the bundle, which is what makes
      // the package usable in browsers and edge runtimes.
      platform: "neutral",
      target: "es2022",
      sourcemap: true,
      // Node 18 webhook HMAC: dynamic `import("node:crypto")`. Не бандлить.
      external: ["node:crypto", "crypto"],
    });
  }
}

execSync("tsc --emitDeclarationOnly", { cwd: root, stdio: "inherit" });

console.log("Built @supportly/sdk");
