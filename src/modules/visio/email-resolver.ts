import type { Logger } from "winston";

import { HttpClient, readJson } from "../../net/http-client";
import { VisioUpstreamError } from "./errors";
import { threepidsSchema } from "./schema";

const THREEPIDS_PATH = "/_matrix/client/v3/account/3pid";

export interface EmailResolverSettings {
  serverUrl: string;
  timeoutMs: number;
}

/** Reads the user's email from the homeserver. */
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
      throw this.#homeserverError(err instanceof Error ? err.message : "request failed");
    }
    if (response.status === 401 || response.status === 403) {
      return null;
    }
    if (!response.ok) {
      throw this.#homeserverError(`status ${response.status}`);
    }

    const body = await readJson(response, threepidsSchema);

    return body?.threepids.find((threepid) => threepid.medium === "email")?.address ?? null;
  }

  #homeserverError(reason: string): VisioUpstreamError {
    const msg = `homeserver failure on ${THREEPIDS_PATH}: ${reason}`;
    this.#log.warn(msg);

    return new VisioUpstreamError(msg, {
      endpoint: THREEPIDS_PATH,
    });
  }
}
