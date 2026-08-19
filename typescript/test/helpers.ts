/** Test doubles for `fetch`, so no test touches the network or the clock. */

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface StubResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** Thrown instead of responding — simulates a network failure. */
  error?: Error;
}

export interface FetchMock {
  fetch: typeof fetch;
  requests: RecordedRequest[];
  /** Delays passed to the injected `sleep`, in call order. */
  sleeps: number[];
  sleep: (ms: number) => Promise<void>;
  calls: number;
}

function toResponse(stub: StubResponse): Response {
  const status = stub.status ?? 200;
  const headers = new Headers(stub.headers ?? {});

  if (status === 204 || stub.body === undefined) {
    return new Response(null, { status, headers });
  }

  const body = typeof stub.body === "string" ? stub.body : JSON.stringify(stub.body);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  return new Response(body, { status, headers });
}

/**
 * Replays `responses` in order; the last one repeats once exhausted, so a test
 * that only cares about the first N attempts does not have to pad the list.
 */
export function mockFetch(responses: StubResponse[]): FetchMock {
  const state: FetchMock = {
    requests: [],
    sleeps: [],
    calls: 0,
    sleep: async (ms: number) => {
      state.sleeps.push(ms);
    },
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const index = Math.min(state.calls, responses.length - 1);
      const stub = responses[index] ?? {};
      state.calls += 1;

      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((value, key) => {
        headers[key] = value;
      });

      let body: unknown;
      if (typeof init?.body === "string") {
        try {
          body = JSON.parse(init.body);
        } catch {
          body = init.body;
        }
      }

      state.requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        headers,
        body,
      });

      // Honour abort signals so timeout tests behave like the real thing.
      const signal = init?.signal;
      if (signal?.aborted) throw abortError();

      if (stub.error) throw stub.error;
      return toResponse(stub);
    }) as typeof fetch,
  };

  return state;
}

/** A `fetch` that never settles until aborted — for timeout tests. */
export function hangingFetch(): typeof fetch {
  return ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return;
      if (signal.aborted) return reject(abortError());
      signal.addEventListener("abort", () => reject(abortError()), { once: true });
    })) as typeof fetch;
}

function abortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}
