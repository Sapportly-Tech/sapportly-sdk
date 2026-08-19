/**
 * Library tsconfig uses `types: []` (browser-safe .d.ts).
 * This shim lets `import("node:crypto")` typecheck during emit without Node globals.
 */
declare module "node:crypto" {
  export const webcrypto: Crypto;
  export function randomUUID(): string;
}
