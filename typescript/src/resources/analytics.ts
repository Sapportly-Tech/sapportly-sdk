import type { RequestOptions, Transport } from "../transport";
import type { TrackMetricRequest, TrackMetricResponse } from "../types";

/** `POST /v1/analytics/track` — scope `analytics:write`. */
export class AnalyticsResource {
  constructor(private readonly transport: Transport) {}

  /**
   * Records a value against a custom metric.
   *
   * The metric must already exist in the panel — `track` never creates one, so
   * an unknown `metric_key` is a 404. Counters accumulate and reject negative
   * values; gauges are overwritten by the last value written.
   *
   * Requires the `analytics` module to be enabled for the tenant.
   */
  track(request: TrackMetricRequest, options?: RequestOptions): Promise<TrackMetricResponse> {
    return this.transport.request<TrackMetricResponse>({
      method: "POST",
      path: "/v1/analytics/track",
      auth: "apiKey",
      body: {
        metric_key: request.metric_key,
        value: request.value ?? 1,
        ...(request.channel ? { channel: request.channel } : {}),
      },
      // A counter increment is not idempotent and there is no key to dedupe on,
      // so a replay would double-count.
      idempotent: false,
      options,
    });
  }
}
