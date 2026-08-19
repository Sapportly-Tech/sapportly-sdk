/**
 * Пример: свой Telegram-бот → Supportly inbox + AI + панель.
 *
 * Один канал на весь бот. Не создавайте канал на каждый chat.id —
 * канал нужен, чтобы гнать обращения через источник и смотреть аналитику
 * (сайт / custom / telegram / бот). Chat id — ваша сущность.
 *
 * Запуск (Node 22+): SUPPORTLY_API_KEY=… BOT_TOKEN=… npx tsx examples/telegram-bot.ts
 */

import { SupportlyClient } from "../src/index";
import { SupportlyInbox } from "../src/inbox";

const CHANNEL = process.env.SUPPORTLY_CHANNEL ?? "custom:telegram";
const apiKey = process.env.SUPPORTLY_API_KEY;
const botToken = process.env.BOT_TOKEN;

if (!apiKey || !botToken) {
  console.error("Нужны SUPPORTLY_API_KEY и BOT_TOKEN");
  process.exit(1);
}

const client = new SupportlyClient({ apiKey });
const inbox = new SupportlyInbox(client, { channels: [CHANNEL] });

/** chat.id, с которым сейчас работаем в своей админке (у вас — БД / UI). */
let selectedChatId: number | null = null;

inbox.onVisitor((msg) => {
  // Лента источника. Тело — plaintext, если на канале нет tenant-шифрования.
  console.log("visitor", msg.channel, msg.body.slice(0, 80));
});

inbox.onAi((draft) => {
  if (draft.partial) return; // промежуточные токены можно показать как «печатает»
  console.log("ai draft", draft.draft_body?.slice(0, 80));
});

inbox.onAgent(async (msg) => {
  if (msg.echo) return; // мы сами вызвали inbox.reply — в Telegram уже отправили
  if (!selectedChatId || !msg.body) return;
  // Ответ оператора из панели Supportly: доставьте в выбранный чат.
  await telegramSend(selectedChatId, msg.body);
});

await inbox.connect();
console.log(`inbox open, channel=${CHANNEL}`);

/**
 * Обработчик Telegram Update (polling / webhook — как удобно).
 * Сюда приходит конкретный человек — chat.id известен.
 */
export async function onTelegramMessage(msg: { chat: { id: number }; message_id: number; text?: string }) {
  selectedChatId = msg.chat.id;

  // Все чаты бота → один канал. Идемпотентность завязана на update, не на канал.
  await client.ingest.send({
    channel: CHANNEL,
    body: msg.text ?? "",
    idempotency_key: `tg:${msg.chat.id}:${msg.message_id}`,
  });
}

/** Ответ из ВАШЕЙ админки: сначала Telegram, потом запись в ленту Supportly. */
export async function replyToUser(chatId: number, text: string) {
  await telegramSend(chatId, text);
  await inbox.reply(CHANNEL, text); // кадр onAgent придёт с echo: true
}

async function telegramSend(chatId: number, text: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) {
    throw new Error(`telegram ${res.status}`);
  }
}
