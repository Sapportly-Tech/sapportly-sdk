import type { RequestOptions, Transport } from "../transport";
import type {
  ArchiveChannelResponse,
  Channel,
  CreateChannelRequest,
  ListChannelsParams,
  UpdateChannelRequest,
} from "../types";

/**
 * Реестр каналов-источников: `/v1/channels`.
 *
 * Один канал на источник (сайт, CRM, коннектор) — для аналитики и ingest.
 * Не создавайте запись на каждого посетителя.
 *
 * Чтение — `channels:read`, изменения — `channels:write`.
 */
export class ChannelsResource {
  constructor(private readonly transport: Transport) {}

  /**
   * Registered channels. Per-visitor widget channels are filtered out — they
   * are ephemeral and would swamp the list.
   *
   * Not paginated by the API: `limit` clamps to 200 and there is no cursor.
   */
  list(params: ListChannelsParams = {}, options?: RequestOptions): Promise<Channel[]> {
    return this.transport.request<Channel[]>({
      method: "GET",
      path: "/v1/channels",
      auth: "apiKey",
      query: {
        limit: params.limit,
        status: params.status,
        namespace: params.namespace,
      },
      asList: true,
      options,
    });
  }

  get(channelId: string, options?: RequestOptions): Promise<Channel> {
    return this.transport.request<Channel>({
      method: "GET",
      path: `/v1/channels/${encodeURIComponent(channelId)}`,
      auth: "apiKey",
      options,
    });
  }

  /** 400 when `(namespace, slug)` is already taken. */
  create(request: CreateChannelRequest, options?: RequestOptions): Promise<Channel> {
    return this.transport.request<Channel>({
      method: "POST",
      path: "/v1/channels",
      auth: "apiKey",
      body: request,
      // Creation has no idempotency key, so a replayed POST could produce a
      // second channel. The unique constraint would reject it, but the caller
      // deserves the real outcome rather than a misleading 400.
      idempotent: false,
      options,
    });
  }

  update(
    channelId: string,
    request: UpdateChannelRequest,
    options?: RequestOptions,
  ): Promise<Channel> {
    return this.transport.request<Channel>({
      method: "PATCH",
      path: `/v1/channels/${encodeURIComponent(channelId)}`,
      auth: "apiKey",
      body: request,
      idempotent: true,
      options,
    });
  }

  /** Soft delete. The default widget channel cannot be archived. */
  archive(channelId: string, options?: RequestOptions): Promise<ArchiveChannelResponse> {
    return this.transport.request<ArchiveChannelResponse>({
      method: "DELETE",
      path: `/v1/channels/${encodeURIComponent(channelId)}`,
      auth: "apiKey",
      idempotent: true,
      options,
    });
  }
}
