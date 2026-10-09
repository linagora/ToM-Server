import type { Logger } from "winston";

import { translate } from "../../i18n/index";
import { HttpClient, readJson } from "../../net/http-client";
import { VisioForbiddenError, VisioOpenIdError, VisioUpstreamError } from "./errors";
import { openIdUserInfoSchema } from "./schema";
import type { SfuGetRequest } from "./types";

const USERINFO_PATH = "/_matrix/federation/v1/openid/userinfo";

export interface OpenIdValidatorSettings {
  /** Where the federation API of the homeserver answers (`synapse.server_url`). */
  serverUrl: string;
  /** The only homeserver whose tokens are accepted (`server.name`). */
  serverName: string;
  timeoutMs: number;
}

/**
 * Resolves the user behind the OpenID token of a MatrixRTC request (MSC4195), as
 * lk-jwt-service does: the homeserver that issued it says who it stands for.
 *
 * ponytail: the token is checked on the configured homeserver only, since v1
 * refuses the users of other homeservers (D30, D-e). The resolution of
 * `matrix_server_name` through `.well-known/matrix/server` comes with federation.
 */
export class OpenIdValidator {
  #config: OpenIdValidatorSettings;
  #http: HttpClient;
  #log: Logger;

  constructor(config: OpenIdValidatorSettings, logger: Logger) {
    this.#config = config;
    this.#http = new HttpClient({
      baseUrl: config.serverUrl,
      timeoutMs: config.timeoutMs,
    });
    this.#log = logger;
  }

  /** The Matrix id of the user, or throws 403 (other server) / 401 (rejected token). */
  async resolve(openIdToken: SfuGetRequest["openid_token"]): Promise<string> {
    if (openIdToken.matrix_server_name !== this.#config.serverName) {
      throw new VisioForbiddenError("visio.user_not_local");
    }

    let response: Response;
    try {
      response = await this.#http.get(`${USERINFO_PATH}?access_token=${encodeURIComponent(openIdToken.access_token)}`);
    } catch (err) {
      throw this.#homeserverError(err instanceof Error ? err.message : translate("log.net.request_failed"));
    }
    if (response.status === 401) {
      throw new VisioOpenIdError("visio.openid_rejected");
    }
    if (!response.ok) {
      throw this.#homeserverError(
        translate("log.net.status", {
          status: response.status,
        }),
      );
    }

    const info = await readJson(response, openIdUserInfoSchema);
    if (!info) {
      throw this.#homeserverError(translate("log.net.unexpected_body"));
    }
    if (!info.sub.endsWith(`:${this.#config.serverName}`)) {
      throw new VisioForbiddenError("visio.user_not_local");
    }

    return info.sub;
  }

  #homeserverError(reason: string): VisioUpstreamError {
    this.#log.warn(
      translate("log.visio.homeserver_failure", {
        endpoint: USERINFO_PATH,
        reason,
      }),
    );

    return new VisioUpstreamError("visio.homeserver_failure", {
      endpoint: USERINFO_PATH,
      reason,
    });
  }
}
