import { afterEach, describe, expect, it, vi } from "vitest";

import { resetDiyListWarnForTests, warnBareListOnce } from "../src/diy-list-warn";

describe("warnBareListOnce", () => {
  afterEach(() => {
    resetDiyListWarnForTests();
    vi.restoreAllMocks();
  });

  it("warns once then stays quiet", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnBareListOnce("/v1/conversations");
    warnBareListOnce("/v1/contacts");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/has_more/);
  });
});
