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
  react: join(srcDir, "react.tsx"),
  vue: join(srcDir, "vue.ts"),
  svelte: join(srcDir, "svelte.ts"),
  next: join(srcDir, "next.tsx"),
};

const external = [
  "react",
  "react/jsx-runtime",
  "vue",
  "svelte",
  "svelte/store",
  "next/script",
];

rmSync(distDir, { recursive: true, force: true });

for (const [name, entry] of Object.entries(entries)) {
  await build({
    entryPoints: [entry],
    outfile: join(distDir, `${name}.js`),
    format: "esm",
    bundle: true,
    platform: "neutral",
    target: "es2022",
    sourcemap: true,
    external,
  });

  await build({
    entryPoints: [entry],
    outfile: join(distDir, `${name}.cjs`),
    format: "cjs",
    bundle: true,
    platform: "neutral",
    target: "es2022",
    sourcemap: true,
    external,
  });
}

execSync("tsc --emitDeclarationOnly", { cwd: root, stdio: "inherit" });

console.log("Built @sapportly/widget-sdk");
