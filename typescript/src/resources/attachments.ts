import { SupportlyError, SupportlyValidationError } from "../errors";
import type { RequestOptions, Transport } from "../transport";
import type {
  Attachment,
  AttachmentMetaResponse,
  UploadIntentRequest,
  UploadIntentResponse,
} from "../types";

/** Bytes accepted by {@link AttachmentsResource.upload}. */
export type UploadContent = Blob | ArrayBuffer | Uint8Array;

export interface UploadParams {
  /** Channel the file will be attached to, e.g. `custom:orders`. */
  channel: string;
  filename: string;
  mimeType: string;
  content: UploadContent;
  /** Hex SHA-256, recorded on the attachment row. Optional. */
  sha256?: string;
}

function contentLength(content: UploadContent): number {
  if (content instanceof Uint8Array) return content.byteLength;
  if (content instanceof ArrayBuffer) return content.byteLength;
  return content.size;
}

function toBodyInit(content: UploadContent): BodyInit {
  if (content instanceof Uint8Array) {
    // Copy into a plain ArrayBuffer: a Uint8Array view over a larger buffer
    // would otherwise upload the whole backing store.
    return content.slice().buffer as ArrayBuffer;
  }
  return content as BodyInit;
}

/**
 * Attachments: `/v1/attachments/*`.
 *
 * Scope `attachments:write` (legacy keys with `messages:write` are also
 * accepted). File bytes never pass through the gateway — the API hands back a
 * presigned S3 URL and the client PUTs directly to it, which is why the 2 MiB
 * request body cap does not apply to uploads.
 */
export class AttachmentsResource {
  constructor(private readonly transport: Transport) {}

  /** Step 1: reserve an attachment id and a presigned upload target. */
  createUploadIntent(
    request: UploadIntentRequest,
    options?: RequestOptions,
  ): Promise<UploadIntentResponse> {
    return this.transport.request<UploadIntentResponse>({
      method: "POST",
      path: "/v1/attachments/intent",
      auth: "apiKey",
      body: request,
      // Each call reserves a new attachment row; a replay leaks a pending row.
      idempotent: false,
      options,
    });
  }

  /**
   * Step 3: finalise the upload.
   *
   * The server re-reads the object, checks size and sniffed MIME type against
   * the intent, runs a malware scan, and only then marks it ready. Rejections
   * here are validation errors (`attachment_type_blocked`, `attachment_infected`,
   * `uploaded size mismatch`), not transport failures.
   */
  async complete(attachmentId: string, options?: RequestOptions): Promise<Attachment> {
    const response = await this.transport.request<AttachmentMetaResponse>({
      method: "POST",
      path: `/v1/attachments/${encodeURIComponent(attachmentId)}/complete`,
      auth: "apiKey",
      idempotent: false,
      options,
    });
    return response.attachment;
  }

  /** Metadata for an attachment. `download_url` is set once it is ready. */
  async get(attachmentId: string, options?: RequestOptions): Promise<Attachment> {
    const response = await this.transport.request<AttachmentMetaResponse>({
      method: "GET",
      path: `/v1/attachments/${encodeURIComponent(attachmentId)}`,
      auth: "apiKey",
      options,
    });
    return response.attachment;
  }

  /**
   * Fetches the file.
   *
   * The endpoint answers with a redirect to a short-lived presigned S3 URL;
   * `fetch` follows it, so the returned `Response` carries the bytes.
   */
  async download(attachmentId: string, options?: RequestOptions): Promise<Response> {
    const response = await this.transport.requestResponse({
      method: "GET",
      path: `/v1/attachments/${encodeURIComponent(attachmentId)}/download`,
      auth: "apiKey",
      options,
    });

    if (!response.ok) {
      throw new SupportlyError(`attachment download failed with HTTP ${response.status}`, {
        status: response.status,
        headers: response.headers,
        method: "GET",
      });
    }

    return response;
  }

  /**
   * Runs the full intent → PUT → complete sequence and returns the ready
   * attachment. Pass the resulting `id` in `attachment_ids` when sending the
   * message that carries the file.
   *
   * ```ts
   * const file = await client.attachments.upload({
   *   channel: "custom:orders",
   *   filename: "invoice.pdf",
   *   mimeType: "application/pdf",
   *   content: bytes,
   * });
   * await client.ingest.send({ channel: "custom:orders", body: "Invoice", attachment_ids: [file.id] });
   * ```
   */
  async upload(params: UploadParams, options?: RequestOptions): Promise<Attachment> {
    const size = contentLength(params.content);
    if (size === 0) {
      throw new SupportlyValidationError("cannot upload an empty file");
    }

    const intent = await this.createUploadIntent(
      {
        filename: params.filename,
        mime_type: params.mimeType,
        size_bytes: size,
        channel: params.channel,
        ...(params.sha256 ? { sha256: params.sha256 } : {}),
      },
      options,
    );

    const put = await this.transport.fetchRaw(intent.upload_url, {
      method: "PUT",
      // The presigned signature covers these headers; sending anything else
      // makes S3 reject the request.
      headers: intent.headers,
      body: toBodyInit(params.content),
      signal: options?.signal,
    });

    if (!put.ok) {
      throw new SupportlyError(`presigned upload failed with HTTP ${put.status}`, {
        status: put.status,
        url: intent.upload_url,
        method: "PUT",
      });
    }

    return this.complete(intent.attachment_id, options);
  }
}
