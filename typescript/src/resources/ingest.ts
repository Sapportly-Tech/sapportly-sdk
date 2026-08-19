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
   * Без `idempotency_key` SDK ставит свой — ретрай не создаст дубль.
   * 202 + `message_id: null` — новое, persist ещё идёт.
   * 200 + заполненный `message_id` — ключ уже был, ничего нового.
   */
  send(request: IngestMessageRequest, options?: RequestOptions): Promise<MessageAccepted> {
    const body: IngestMessageRequest = {
      ...request,
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
