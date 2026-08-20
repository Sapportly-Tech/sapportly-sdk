import { describe, expect, it } from "vitest";
import {
  bindThreadKey,
  composeThreadChannel,
  conversationMatchesSource,
  deriveThreadId,
  parseConversationKey,
  sourceChannel,
  THREAD_ID_NAMESPACE,
} from "../src/channels";

describe("conversation keys", () => {
  it("parses source and thread", () => {
    const src = parseConversationKey("custom:unichannel");
    expect(src?.sourceChannel).toBe("custom:unichannel");
    expect(src?.threadId).toBeNull();

    const id = "550e8400-e29b-41d4-a716-446655440000";
    const th = parseConversationKey(`custom:unichannel:${id}`);
    expect(th?.sourceChannel).toBe("custom:unichannel");
    expect(th?.threadId).toBe(id);
    expect(sourceChannel(`custom:unichannel:${id}`)).toBe("custom:unichannel");
  });

  it("maps widget visitor to widget:web", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    const key = parseConversationKey(`widget:${id}`);
    expect(key?.sourceChannel).toBe("widget:web");
    expect(key?.threadId).toBe(id);
    expect(key?.conversationChannel).toBe(`widget:${id}`);
  });

  it("derives a stable UUID v5 matching the gateway", async () => {
    expect(THREAD_ID_NAMESPACE).toBe("a1f0c3e8-7b2d-4e91-9c54-6d8e0b1a2c3d");
    const id = await deriveThreadId("custom:shop", "tg:42");
    expect(id).toBe("c83017e1-1221-546d-9c06-e77122b98901");
    const a = await bindThreadKey("custom:shop", { externalId: "tg:42" });
    const b = await bindThreadKey("custom:shop", { externalId: "tg:42" });
    expect(a).toBe(b);
    expect(a).toBe(`custom:shop:${id}`);
    expect(await bindThreadKey("custom:shop", { externalId: "tg:1" })).not.toBe(a);
  });

  it("keeps legacy source without identity", async () => {
    expect(await bindThreadKey("custom:shop", {})).toBe("custom:shop");
  });

  it("matches source filters", () => {
    const thread = composeThreadChannel("custom:shop", "550e8400-e29b-41d4-a716-446655440000");
    expect(conversationMatchesSource(thread, "custom:shop")).toBe(true);
    expect(conversationMatchesSource("custom:shop", "custom:shop")).toBe(true);
    expect(conversationMatchesSource(thread, "custom:other")).toBe(false);
  });

  it("rejects widget three-part keys", () => {
    expect(parseConversationKey("widget:web:550e8400-e29b-41d4-a716-446655440000")).toBeNull();
  });
});
