/** One-shot console warn when bare list APIs unwrap the envelope (no has_more). */

let warned = false;

/** @internal Reset in tests. */
export function resetDiyListWarnForTests(): void {
  warned = false;
}

/**
 * DIY `while (page.length === limit)` loops infinite-loop on a full final page.
 * Prefer `*Page` / `iterate*` which honour `has_more`.
 */
export function warnBareListOnce(path?: string): void {
  if (warned) return;
  warned = true;
  if (typeof console === "undefined" || typeof console.warn !== "function") return;
  const where = path ? ` (${path})` : "";
  console.warn(
    `[sapportly] Bare list response has no has_more${where}. Prefer *Page / iterate* — do not DIY-loop while page.length === limit.`,
  );
}
