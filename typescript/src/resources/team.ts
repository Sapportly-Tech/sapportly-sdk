import type { RequestOptions, Transport } from "../transport";
import type { TeamRole } from "../types";

/** `GET /v1/team/roles` — scope `team:read`. */
export class TeamResource {
  constructor(private readonly transport: Transport) {}

  /**
   * Roles defined for the tenant, with permissions and member counts.
   *
   * `external_key` is the stable handle to use when assigning conversations
   * from an external system — role ids are not portable between tenants.
   */
  listRoles(options?: RequestOptions): Promise<TeamRole[]> {
    return this.transport.request<TeamRole[]>({
      method: "GET",
      path: "/v1/team/roles",
      auth: "apiKey",
      asList: true,
      options,
    });
  }
}
