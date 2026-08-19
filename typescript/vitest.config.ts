import { webcrypto } from "node:crypto";
import { defineConfig } from "vitest/config";

// Node 18: Web Crypto is not on globalThis. Production code falls back to
// `import("node:crypto")`; this makes the test environment match Node 19+.
if (typeof globalThis.crypto?.subtle !== "object") {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
}

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
  ssr: {
    external: ["node:crypto", "crypto"],
  },
});
