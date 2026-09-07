import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  WIDGET_GLUE_ASSET_VERSION,
  WIDGET_SDK_VERSION,
  WIDGET_WASM_ASSET_VERSION,
} from "../src/constants";
import { supportlyLoaderKey } from "../src/loader";
import {
  createLoaderOptions,
  loaderOptionsFromEnv,
  resolveSiteId,
} from "../src/options";
import { buildEmbedSnippet, buildScriptAttributes, buildScriptUrl } from "../src/snippet";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  name: string;
  version: string;
  publishConfig?: { access?: string };
  exports?: Record<string, unknown>;
  peerDependencies?: Record<string, string>;
};

const SITE_ENV_KEYS = [
  "NEXT_PUBLIC_SUPPORTLY_SITE_ID",
  "VITE_SUPPORTLY_SITE_ID",
  "PUBLIC_SUPPORTLY_SITE_ID",
  "SUPPORTLY_SITE_ID",
] as const;

const savedEnv: Record<string, string | undefined> = {};

function clearSiteEnv(): void {
  for (const key of SITE_ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
}

afterEach(() => {
  for (const key of SITE_ENV_KEYS) {
    const prev = savedEnv[key];
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
});

describe("package metadata", () => {
  it("публикуется как @sapportly/widget-sdk без private ./api", () => {
    expect(pkg.name).toBe("@sapportly/widget-sdk");
    expect(pkg.publishConfig?.access).toBe("public");
    expect(pkg.exports?.["./api"]).toBeUndefined();
    expect(pkg.peerDependencies).not.toHaveProperty("@sapportly/api");
    expect(pkg.peerDependencies).not.toHaveProperty("@sapportly/sdk");
  });

  it("хеши cache-bust — 12 hex-символов", () => {
    expect(WIDGET_WASM_ASSET_VERSION).toMatch(/^[0-9a-f]{12}$/);
    expect(WIDGET_GLUE_ASSET_VERSION).toMatch(/^[0-9a-f]{12}$/);
    expect(WIDGET_SDK_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("snippet", () => {
  it("собирает HTML со Site ID и cache-bust WASM", () => {
    const html = buildEmbedSnippet({ siteId: "wgt_abc" });
    expect(html).toContain('data-site-id="wgt_abc"');
    expect(html).toContain("https://cdn.sapportly.pro/supportly.widget.js");
    expect(html).toContain(`v=${WIDGET_WASM_ASSET_VERSION}`);
    expect(html).toContain("window.Sapportly=window.Sapportly||{q:[]}");
    expect(html).toContain("https://api.sapportly.pro");
  });

  it("экранирует HTML в атрибутах", () => {
    const html = buildEmbedSnippet({ siteId: `wgt_"x`, title: "<script>" });
    expect(html).toContain("&quot;");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain('data-title="<script>"');
  });

  it("buildScriptUrl использует CDN и версию", () => {
    expect(buildScriptUrl({})).toBe(
      `https://cdn.sapportly.pro/supportly.widget.js?v=${WIDGET_WASM_ASSET_VERSION}`,
    );
    expect(buildScriptUrl({ cdnUrl: "https://cdn.example/", version: "abc" })).toBe(
      "https://cdn.example/supportly.widget.js?v=abc",
    );
  });

  it("buildScriptAttributes не кладёт пустые поля", () => {
    const attrs = buildScriptAttributes({ siteId: "wgt_1", title: "Chat" });
    expect(attrs["data-site-id"]).toBe("wgt_1");
    expect(attrs["data-title"]).toBe("Chat");
    expect(attrs["data-ws-url"]).toBeUndefined();
  });
});

describe("options", () => {
  it("явный siteId важнее env", () => {
    clearSiteEnv();
    process.env.SUPPORTLY_SITE_ID = "wgt_env";
    expect(resolveSiteId({ siteId: "  wgt_explicit  " })).toBe("wgt_explicit");
  });

  it("читает SUPPORTLY_SITE_ID", () => {
    clearSiteEnv();
    process.env.SUPPORTLY_SITE_ID = "wgt_from_env";
    expect(resolveSiteId()).toBe("wgt_from_env");
  });

  it("loaderOptionsFromEnv бросает без Site ID", () => {
    clearSiteEnv();
    expect(() => loaderOptionsFromEnv()).toThrow(/Site ID is required/);
  });

  it("createLoaderOptions мержит строку и overrides", () => {
    const opts = createLoaderOptions("wgt_base", { apiUrl: "https://api.example" });
    expect(opts.siteId).toBe("wgt_base");
    expect(opts.apiUrl).toBe("https://api.example");
  });
});

describe("loader key", () => {
  it("стабилен для одинаковых опций", () => {
    const a = supportlyLoaderKey({ siteId: "wgt_1", apiUrl: "https://api.sapportly.pro" });
    const b = supportlyLoaderKey({ siteId: "wgt_1", apiUrl: "https://api.sapportly.pro" });
    expect(a).toBe(b);
    expect(supportlyLoaderKey({ siteId: "wgt_2" })).not.toBe(a);
  });
});
