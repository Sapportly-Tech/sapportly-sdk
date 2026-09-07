/**
 * Пример: свой Telegram-бот → Sapportly inbox + AI + панель.
 *
 * Один источник на весь бот (`custom:telegram`). Тред 1:1 собирается из
 * `identity.external_id` (chat.id) → `custom:telegram:{uuid}`.
 * Не создавайте канал на каждый chat.id — аналитика тогда разъедется.
 *
 * Запуск (Node 22+): SAPPORTLY_API_KEY=… BOT_TOKEN=… npx tsx examples/telegram-bot.ts
 * (legacy alias: SUPPORTLY_API_KEY)
 */

import { bindThreadKey, SapportlyClient } from "../src/index";
import { SapportlyInbox } from "../src/inbox";

const CHANNEL =
  process.env.SAPPORTLY_CHANNEL ?? process.env.SUPPORTLY_CHANNEL ?? "custom:telegram";
const apiKey =
  process.env.SAPPORTLY_API_KEY?.trim() || process.env.SUPPORTLY_API_KEY?.trim();
const botToken = process.env.BOT_TOKEN;

if (!apiKey || !botToken) {
  console.error("Нужны SAPPORTLY_API_KEY (или SUPPORTLY_API_KEY) и BOT_TOKEN");
  process.exit(1);
}

const client = new SapportlyClient({ apiKey });
const inbox = new SapportlyInbox(client, { channels: [CHANNEL] });

inbox.onVisitor((msg) => {
  console.log("visitor", msg.channel, msg.externalId, msg.body.slice(0, 80));
});

inbox.onAi((draft) => {
  if (draft.partial) return;
  console.log("ai draft", draft.draft_body?.slice(0, 80));
});

inbox.onAgent(async (msg) => {
  if (msg.echo) return;
  if (!msg.body) return;
  const chatId = msg.externalId;
  if (!chatId) {
    console.warn("нет external_id на кадре — некому доставить", msg.channel);
    return;
  }
  await telegramSend(chatId, msg.body);
});

await inbox.connect();
console.log(`inbox open, source=${CHANNEL}`);

/**
 * Обработчик Telegram Update (polling / webhook — как удобно).
 */
export async function onTelegramMessage(msg: {
  chat: { id: number };
  message_id: number;
  text?: string;
}) {
  await client.ingest.send({
    channel: CHANNEL,
    body: msg.text ?? "",
    idempotency_key: `tg:${msg.chat.id}:${msg.message_id}`,
    identity: { external_id: String(msg.chat.id) },
  });
}

/** Ответ из ВАШЕЙ админки: сначала Telegram, потом запись в ленту треда. */
export async function replyToUser(chatId: number, text: string) {
  await telegramSend(String(chatId), text);
  const thread = await bindThreadKey(CHANNEL, { externalId: String(chatId) });
  await inbox.reply(thread, text);
}

async function telegramSend(chatId: string, text: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) {
    throw new Error(`telegram ${res.status}`);
  }
}
