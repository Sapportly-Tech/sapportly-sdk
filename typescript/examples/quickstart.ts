/**
 * Supportly TypeScript SDK — quick start.
 *
 * Run with: npx tsx examples/quickstart.ts
 * Requires: SUPPORTLY_API_KEY with scopes messages:write and conversations:read
 */
import {
  collect,
  SupportlyClient,
  SupportlyError,
  SupportlyPermissionError,
  SupportlyRateLimitError,
} from "../src/index";

const apiKey = process.env.SUPPORTLY_API_KEY;
if (!apiKey) {
  console.error("Set SUPPORTLY_API_KEY to run this example.");
  process.exit(1);
}

const client = new SupportlyClient({ apiKey, timeoutMs: 10_000 });

const status = await client.status();
console.log(`API ${status.version} (${status.phase})`);

// Канал — источник (этот скрипт), не чат с человеком. SDK сам ставит
// idempotency_key, поэтому ретрай на 429/5xx безопасен.
const accepted = await client.ingest.send({
  channel: "custom:quickstart",
  body: "Hello from the TypeScript SDK",
});
console.log(`accepted=${accepted.accepted} message_id=${accepted.message_id ?? "(queued)"}`);

// Keyset pagination, handled by the iterator.
const conversations = await collect(client.conversations.iterate({ limit: 20, maxItems: 5 }));
for (const conversation of conversations) {
  console.log(`${conversation.channel}  ${conversation.last_at}  ${conversation.last_message}`);
}

// Errors are typed, so a caller can branch without reading status codes.
try {
  await client.team.listRoles();
} catch (error) {
  if (error instanceof SupportlyPermissionError) {
    console.warn("this key has no team:read scope — skipping roles");
  } else if (error instanceof SupportlyRateLimitError) {
    console.warn(`rate limited, retry in ${error.retryAfterMs ?? "?"}ms`);
  } else if (error instanceof SupportlyError) {
    console.error(`${error.name}: ${error.message} (status ${error.status})`);
  } else {
    throw error;
  }
}
