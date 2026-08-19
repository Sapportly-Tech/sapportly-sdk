import type { RequestOptions, Transport } from "../transport";
import type { WebhookConfig, WebhookConfigUpdate, WebhookTestResult } from "../types";

/**
 * Outbound webhook endpoint — `GET/PUT /v1/webhooks`.
 *
 * Reads need `conversations:read` (or `conversations:write`); mutations need
 * `conversations:write`. Signature verification stays in
 * `@supportly/sdk/webhooks` and does not need this resource.
 */
export class WebhooksResource {
  constructor(private readonly transport: Transport) {}

  get(options?: RequestOptions): Promise<WebhookConfig> {
    return this.transport.request<WebhookConfig>({
      method: "GET",
      path: "/v1/webhooks",
      auth: "apiKey",
      options,
    });
  }

  update(request: WebhookConfigUpdate, options?: RequestOptions): Promise<WebhookConfig> {
    return this.transport.request<WebhookConfig>({
      method: "PUT",
      path: "/v1/webhooks",
      auth: "apiKey",
      body: request,
      idempotent: true,
      options,
    });
  }

  test(options?: RequestOptions): Promise<WebhookTestResult> {
    return this.transport.request<WebhookTestResult>({
      method: "POST",
      path: "/v1/webhooks/test",
      auth: "apiKey",
      idempotent: false,
      options,
    });
  }
}
