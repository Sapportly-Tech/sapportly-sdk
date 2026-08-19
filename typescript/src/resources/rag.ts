import type { RequestOptions, Transport } from "../transport";
import type { RagDocumentAccepted, RagDocumentList, RagUploadParams } from "../types";

async function resolveBody(request: RagUploadParams): Promise<string> {
  if (typeof request.body === "string" && request.body.trim()) return request.body;
  const content = request.content;
  if (typeof content === "string") return content;
  if (content instanceof Uint8Array) return new TextDecoder().decode(content);
  if (typeof Blob !== "undefined" && content instanceof Blob) return content.text();
  return "";
}

/**
 * RAG ingest — `/v1/rag/documents`.
 *
 * Scope `attachments:write` (legacy `messages:write` also accepted) to write.
 * List/read also accept `conversations:read`. Search stays on the panel.
 */
export class RagResource {
  constructor(private readonly transport: Transport) {}

  list(options?: RequestOptions): Promise<RagDocumentList> {
    return this.transport.request<RagDocumentList>({
      method: "GET",
      path: "/v1/rag/documents",
      auth: "apiKey",
      options,
    });
  }

  /**
   * Indexes a text document. JSON `{ title, body }` — not multipart.
   * `filename` / `content` are accepted as a compatibility fallback.
   */
  async upload(request: RagUploadParams, options?: RequestOptions): Promise<RagDocumentAccepted> {
    const title = (request.title || request.filename || "").trim() || "Untitled";
    const body = await resolveBody(request);

    return this.transport.request<RagDocumentAccepted>({
      method: "POST",
      path: "/v1/rag/documents",
      auth: "apiKey",
      body: { title, body },
      idempotent: false,
      options,
    });
  }

  delete(id: string, options?: RequestOptions): Promise<{ deleted: boolean }> {
    return this.transport.request<{ deleted: boolean }>({
      method: "DELETE",
      path: `/v1/rag/documents/${encodeURIComponent(id)}`,
      auth: "apiKey",
      options,
    });
  }
}
