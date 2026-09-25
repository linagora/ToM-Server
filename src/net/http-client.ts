import type { z } from "zod";

export interface HttpClientSettings {
  baseUrl: string;
  timeoutMs: number;
}

/** The remote could not be reached: network failure or timeout. */
export class UnreachableError extends Error {
  constructor(message: string, options: ErrorOptions) {
    super(message, options);
    this.name = "UnreachableError";
  }
}

export class HttpClient {
  #baseUrl: string;
  #timeoutMs: number;

  constructor(settings: HttpClientSettings) {
    this.#baseUrl = settings.baseUrl.replace(/\/+$/, "");
    this.#timeoutMs = settings.timeoutMs;
  }

  get(path: string, token?: string): Promise<Response> {
    return this.#request(
      path,
      {
        method: "GET",
      },
      token,
    );
  }

  post(path: string, body: Record<string, unknown>, token?: string): Promise<Response> {
    return this.#request(
      path,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      token,
    );
  }

  async #request(path: string, init: RequestInit, token?: string): Promise<Response> {
    try {
      return await fetch(`${this.#baseUrl}${path}`, {
        ...init,
        headers: {
          ...init.headers,
          ...(token
            ? {
                Authorization: `Bearer ${token}`,
              }
            : {}),
        },
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (err) {
      throw new UnreachableError(err instanceof Error ? `${err.name}: ${err.message}` : "request failed", {
        cause: err,
      });
    }
  }
}

/** The response body validated against `schema`, or undefined when missing or invalid. */
export async function readJson<Schema extends z.ZodType>(
  response: Response,
  schema: Schema,
): Promise<z.infer<Schema> | undefined> {
  const payload: unknown = await response.json().catch(() => undefined);
  const result = schema.safeParse(payload);

  return result.success ? result.data : undefined;
}
