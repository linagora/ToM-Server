import type { Logger } from "winston";

import { translate } from "../../i18n/index";
import { HttpClient, readJson } from "../../net/http-client";
import { VisioUpstreamError } from "./errors";
import { threepidsSchema } from "./schema";

const THREEPIDS_PATH = "/_matrix/client/v3/account/3pid";

export interface EmailResolverSettings {
  serverUrl: string;
  timeoutMs: number;
}

/** Reads the user's email from the homeserver; null when it has none or several. */
export class EmailResolver {
  #http: HttpClient;
  #log: Logger;

  constructor(settings: EmailResolverSettings, logger: Logger) {
    this.#http = new HttpClient({
      baseUrl: settings.serverUrl,
      timeoutMs: settings.timeoutMs,
    });
    this.#log = logger;
  }

  async resolve(token: string): Promise<string | null> {
    let response: Response;
    try {
      response = await this.#http.get(THREEPIDS_PATH, token);
    } catch (err) {
      throw this.#homeserverError(err instanceof Error ? err.message : translate("log.net.request_failed"));
    }
    if (!response.ok) {
      throw this.#homeserverError(
        translate("log.net.status", {
          status: response.status,
        }),
      );
    }

    const body = await readJson(response, threepidsSchema);

    const emails = body?.threepids.filter((threepid) => threepid.medium === "email") ?? [];
    const [email] = emails;
    if (!email || emails.length > 1) {
      this.#log.warn(translate("log.visio.email_count"), {
        count: emails.length,
      });

      return null;
    }

    return email.address;
  }

  #homeserverError(reason: string): VisioUpstreamError {
    this.#log.warn(
      translate("log.visio.homeserver_failure", {
        endpoint: THREEPIDS_PATH,
        reason,
      }),
    );

    return new VisioUpstreamError("visio.homeserver_failure", {
      endpoint: THREEPIDS_PATH,
      reason,
    });
  }
}
