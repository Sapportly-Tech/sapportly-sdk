import { bindThreadKey, threadIdFromChannel } from "../channels";
import { generateIdempotencyKey } from "../idempotency";
import type { RequestOptions, Transport } from "../transport";
import type { IngestMessageRequest, MessageAccepted } from "../types";

/**
 * `POST /v1/ingest/messages` — входящие от CRM / бэкенда. Scope `messages:write`.
 *
 * Это не ответ оператора: ответ — `conversations.reply`.
 */
export class IngestResource {
  constructor(private readonly transport: Transport) {}

  /**
   * Положить входящее в канал-источник.
   *
   * `channel` — `namespace:slug` источника (`custom:shop`), не id посетителя.
   * Либо `channel_slug` + опционально `channel_namespace` (запись из реестра).
   *
   * Если есть `identity.external_id` или `thread_id`, шлюз (и SDK) собирают тред
   * `custom:shop:{uuid}` — отдельный диалог в панели и для ИИ, тот же источник в аналитике.
   *
   * Без `idempotency_key` SDK ставит свой — ретрай не создаст дубль.
   * 202 + `message_id: null` — новое, persist ещё идёт.
   * 200 + заполненный `message_id` — ключ уже был, ничего нового.
   */
  async send(request: IngestMessageRequest, options?: RequestOptions): Promise<MessageAccepted> {
    let channel = request.channel;
    if (channel) {
      channel = await bindThreadKey(channel, {
        thread: request.thread_id,
        externalId: request.identity?.external_id,
      });
    }
    const body: IngestMessageRequest = {
      ...request,
      channel,
      thread_id: channel ? (threadIdFromChannel(channel) ?? undefined) : request.thread_id,
      idempotency_key: request.idempotency_key ?? generateIdempotencyKey(),
      attachment_ids: request.attachment_ids ?? [],
    };

    return this.transport.request<MessageAccepted>({
      method: "POST",
      path: "/v1/ingest/messages",
      auth: "apiKey",
      body,
      idempotent: true,
      options,
    });
  }
}
