import { describe, expect, it } from "vitest";

import { SapportlyConfigError } from "../src/errors";
import { assertTrustedWebsocketUrl } from "../src/resources/realtime";

describe("assertTrustedWebsocketUrl", () => {
  it("allows api↔ws swap and same root", () => {
    assertTrustedWebsocketUrl("wss://ws.sapportly.pro/ws", "https://api.sapportly.pro");
    assertTrustedWebsocketUrl("wss://api.sapportly.pro/ws", "https://api.sapportly.pro");
  });

  it("rejects foreign hosts", () => {
    expect(() =>
      assertTrustedWebsocketUrl("wss://evil.example/ws", "https://api.sapportly.pro"),
    ).toThrow(SapportlyConfigError);
  });

  it("rejects cleartext ws outside localhost", () => {
    expect(() =>
      assertTrustedWebsocketUrl("ws://ws.sapportly.pro/ws", "https://api.sapportly.pro"),
    ).toThrow(SapportlyConfigError);
  });

  it("allows RFC 2606 .test lab hosts for both sides", () => {
    assertTrustedWebsocketUrl("wss://ws.test/ws", "https://api.test");
  });

  it("rejects mixing production API with .test websocket", () => {
    expect(() =>
      assertTrustedWebsocketUrl("wss://ws.test/ws", "https://api.sapportly.pro"),
    ).toThrow(SapportlyConfigError);
  });
});
