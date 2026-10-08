import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { Writable } from "node:stream";

import { createLogger, format, type Logger, transports } from "winston";

import {
  BAD_GATEWAY,
  BOT_RECOVERY_NEEDED,
  NOT_FOUND,
  SERVICE_UNAVAILABLE,
  UNPROCESSABLE,
} from "../../errors/error-codes";
import { loadMessages } from "../../i18n/index";
import { HarnessBotsService } from "./harness";
import type { BotsSettings } from "./types";

const silentLogger = createLogger({
  silent: true,
});

const OWNER = "@dwho:example.com";
const OWNER_PATH = "/agents/v1/provisioning/assistants/%40dwho%3Aexample.com";
const BOT = {
  userId: "@bot_dwho:example.com",
  deviceId: "QSOHWCKQYR",
  masterKey: "mk+base64",
};

interface Seen {
  method: string;
  path: string;
  authorization: string | null;
  body: string;
}

type Answer = (request: Seen) => Response | Promise<Response>;

/** A fake harness and OIDC provider on one local port, which records what it was asked. */
const startFake = (
  answer: Answer,
): {
  url: string;
  seen: Seen[];
  stop: () => void;
} => {
  const seen: Seen[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req: Request): Promise<Response> {
      const request = {
        method: req.method,
        path: new URL(req.url).pathname,
        authorization: req.headers.get("authorization"),
        body: await req.text(),
      };
      seen.push(request);
      return answer(request);
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    seen,
    stop: () => server.stop(true),
  };
};

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });

/** The token endpoint, numbering the tokens it gives. */
const tokens = (): ((request: Seen) => Response | undefined) => {
  let given = 0;
  return (request: Seen): Response | undefined => {
    if (request.path !== "/oauth2/token") return undefined;
    given += 1;
    return json(200, {
      access_token: `tok-${given}`,
      token_type: "Bearer",
      expires_in: 300,
    });
  };
};

const settings = (url: string, overrides: Partial<BotsSettings> = {}): BotsSettings => ({
  enabled: true,
  backend: "harness",
  harness: {
    url: `${url}/agents`,
    token_url: `${url}/oauth2/token`,
    client_id: "tom",
    client_secret: "s3cret",
    scope: "openid",
  },
  hermes_home: "/opt/data",
  model: {
    provider: "openrouter",
    name: "model",
  },
  bot_localpart_prefix: "bot_",
  device_id_prefix: "HERMES",
  commands: [],
  timeout_ms: 1000,
  ready_timeout_ms: 2000,
  publish_interval_ms: 60000,
  ...overrides,
});

const serviceOf = (config: BotsSettings, logger: Logger = silentLogger): HarnessBotsService => {
  if (!config.harness) throw new Error("no harness");
  return new HarnessBotsService(config, config.harness, logger);
};

/** A logger that keeps every line it writes, as JSON. */
const capturing = (): {
  logger: Logger;
  lines: string[];
} => {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding: string, next: () => void): void {
      lines.push(String(chunk));
      next();
    },
  });
  return {
    logger: createLogger({
      format: format.json(),
      transports: [
        new transports.Stream({
          stream,
        }),
      ],
    }),
    lines,
  };
};

let fake: ReturnType<typeof startFake> | null = null;

describe("HarnessBotsService", () => {
  beforeAll(() => {
    loadMessages(join(import.meta.dir, "../../../assets/i18n"), silentLogger);
  });

  afterEach(() => {
    fake?.stop();
    fake = null;
  });

  it("asks the harness for the bot of the owner, with a token of ToM's own client", async () => {
    const token = tokens();
    fake = startFake((request) => token(request) ?? json(200, BOT));

    const bot = await serviceOf(settings(fake.url)).provision(OWNER, "syt_owner", "Europe/Paris");

    expect(bot).toEqual(BOT);
    const [grant, put] = fake.seen;
    expect(grant?.method).toBe("POST");
    expect(grant?.authorization).toBe(`Basic ${Buffer.from("tom:s3cret").toString("base64")}`);
    expect(new URLSearchParams(grant?.body).get("grant_type")).toBe("client_credentials");
    // LemonLDAP-NG answers invalid_scope to a client credentials request that names no scope
    expect(new URLSearchParams(grant?.body).get("scope")).toBe("openid");
    expect(put?.method).toBe("PUT");
    expect(put?.path).toBe(OWNER_PATH);
    expect(put?.authorization).toBe("Bearer tok-1");
    expect(JSON.parse(put?.body ?? "")).toEqual({
      timezone: "Europe/Paris",
    });
  });

  it("logs the endpoints it calls, never the owner it calls them for", async () => {
    const { logger, lines } = capturing();
    const token = tokens();
    fake = startFake(
      (request) =>
        token(request) ??
        (request.path.endsWith("/home")
          ? json(500, {})
          : json(503, {
              error: "not_ready",
            })),
    );
    const config = settings(fake.url, {
      ready_timeout_ms: 300,
    });
    const unreachable = settings("http://127.0.0.1:1");
    if (!unreachable.harness || !config.harness) throw new Error("no harness");
    unreachable.harness.token_url = config.harness.token_url;

    await serviceOf(config, logger)
      .provision(OWNER, "syt_owner")
      .catch(() => undefined);
    await serviceOf(config, logger)
      .setHome(OWNER, "!dm:example.com")
      .catch(() => undefined);
    await serviceOf(unreachable, logger)
      .provision(OWNER, "syt_owner")
      .catch(() => undefined);

    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines.filter((line) => line.includes("dwho"))).toEqual([]);
    expect(lines.some((line) => line.includes("PUT /v1/provisioning/assistants/{owner}/home"))).toBe(true);
    expect(lines.some((line) => line.includes("PUT /v1/provisioning/assistants/{owner}:"))).toBe(true);
  });

  it("form-encodes the client credentials before Basic, as RFC 6749 §2.3.1 says", async () => {
    const token = tokens();
    fake = startFake((request) => token(request) ?? json(200, BOT));
    const config = settings(fake.url);
    if (!config.harness) throw new Error("no harness");
    config.harness.client_id = "tom:b2b";
    config.harness.client_secret = "p@ss w:rd/+&é";

    await serviceOf(config).provision(OWNER, "syt_owner");

    expect(fake.seen[0]?.authorization).toBe(
      `Basic ${Buffer.from("tom%3Ab2b:p%40ss+w%3Ard%2F%2B%26%C3%A9").toString("base64")}`,
    );
  });

  it("shares one token request between calls that need a token at once", async () => {
    let grants = 0;
    fake = startFake(async (request) => {
      if (request.path !== "/oauth2/token") return json(200, BOT);
      grants += 1;
      await Bun.sleep(50);
      return json(200, {
        access_token: "tok-shared",
        expires_in: 300,
      });
    });
    const service = serviceOf(settings(fake.url));

    await Promise.all([
      service.provision(OWNER, "syt_owner"),
      service.provision("@rose:example.com", "syt_rose"),
    ]);

    expect(grants).toBe(1);
    expect(fake.seen.filter((request) => request.method === "PUT").map((request) => request.authorization)).toEqual([
      "Bearer tok-shared",
      "Bearer tok-shared",
    ]);
  });

  it("asks again while the harness prepares the identity of the bot, as it says when", async () => {
    const token = tokens();
    let asked = 0;
    fake = startFake((request) => {
      const grant = token(request);
      if (grant) return grant;
      asked += 1;
      return asked < 3
        ? json(
            503,
            {
              error: "not_ready",
            },
            {
              "Retry-After": "0",
            },
          )
        : json(200, BOT);
    });

    const bot = await serviceOf(
      settings(fake.url, {
        ready_timeout_ms: 5000,
      }),
    ).provision(OWNER, "syt_owner");

    expect(bot).toEqual(BOT);
    expect(fake.seen.map((request) => request.path)).toEqual([
      "/oauth2/token",
      OWNER_PATH,
      OWNER_PATH,
      OWNER_PATH,
    ]);
  });

  it("tells the client to come back when the bot is still not ready at the deadline", async () => {
    const token = tokens();
    fake = startFake(
      (request) =>
        token(request) ??
        json(503, {
          error: "not_ready",
        }),
    );

    await expect(
      serviceOf(
        settings(fake.url, {
          ready_timeout_ms: 300,
        }),
      ).provision(OWNER, "syt_owner"),
    ).rejects.toMatchObject({
      code: SERVICE_UNAVAILABLE,
    });
  });

  it("paces its calls when the harness does not say when to come back", async () => {
    const token = tokens();
    fake = startFake(
      (request) =>
        token(request) ??
        json(503, {
          error: "not_ready",
        }),
    );
    const started = Date.now();

    await expect(
      serviceOf(
        settings(fake.url, {
          ready_timeout_ms: 1500,
        }),
      ).provision(OWNER, "syt_owner"),
    ).rejects.toMatchObject({
      code: SERVICE_UNAVAILABLE,
    });

    // A call, a second's pause, a call, and no pause the budget cannot afford
    expect(fake.seen.filter((request) => request.path === OWNER_PATH)).toHaveLength(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1000);
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it("answers within its time budget when the harness is slow", async () => {
    const token = tokens();
    fake = startFake(async (request) => {
      const grant = token(request);
      if (grant) return grant;
      await Bun.sleep(600);
      return json(200, BOT);
    });
    const started = Date.now();

    await expect(
      serviceOf(
        settings(fake.url, {
          ready_timeout_ms: 200,
        }),
      ).provision(OWNER, "syt_owner"),
    ).rejects.toMatchObject({
      code: SERVICE_UNAVAILABLE,
    });
    expect(Date.now() - started).toBeLessThan(450);
  });

  it("answers within its time budget when the OIDC provider is slow", async () => {
    fake = startFake(async (request) => {
      if (request.path !== "/oauth2/token") return json(200, BOT);
      await Bun.sleep(600);
      return json(200, {
        access_token: "tok",
        expires_in: 300,
      });
    });
    const started = Date.now();

    await expect(
      serviceOf(
        settings(fake.url, {
          ready_timeout_ms: 200,
        }),
      ).provision(OWNER, "syt_owner"),
    ).rejects.toMatchObject({
      code: SERVICE_UNAVAILABLE,
    });
    expect(Date.now() - started).toBeLessThan(450);
  });

  it("says the owner is not one the harness serves", async () => {
    const token = tokens();
    fake = startFake(
      (request) =>
        token(request) ??
        json(422, {
          error: "owner not on the homeserver",
        }),
    );

    await expect(serviceOf(settings(fake.url)).provision(OWNER, "syt_owner")).rejects.toMatchObject({
      code: UNPROCESSABLE,
    });
  });

  it("says the bot waits for its owner's recovery, without asking again", async () => {
    const token = tokens();
    let calls = 0;
    fake = startFake((request) => {
      const answer = token(request);
      if (answer) return answer;
      calls += 1;
      return json(409, {
        error: "recovery_needed",
      });
    });

    await expect(serviceOf(settings(fake.url)).provision(OWNER, "syt_owner")).rejects.toMatchObject({
      code: BOT_RECOVERY_NEEDED,
      message: "bots.recovery_needed",
    });
    expect(calls).toBe(1);
  });

  it("reads the bot of the owner from the harness, without asking it to make one", async () => {
    const token = tokens();
    fake = startFake((request) => token(request) ?? json(200, BOT));

    const bot = await serviceOf(settings(fake.url)).find(OWNER, "syt_owner");

    expect(bot).toEqual(BOT);
    const asked = fake.seen.filter((request) => request.path !== "/oauth2/token");
    expect(asked.map((request) => `${request.method} ${request.path} ${request.authorization}`)).toEqual([
      `GET ${OWNER_PATH} Bearer tok-1`,
    ]);
    expect(asked[0]?.body).toBe("");
  });

  it("finds no bot for an owner who has none or deleted theirs, and makes none", async () => {
    const token = tokens();
    fake = startFake(
      (request) =>
        token(request) ??
        json(404, {
          error: "no assistant",
        }),
    );

    expect(await serviceOf(settings(fake.url)).find(OWNER, "syt_owner")).toBeNull();
    expect(fake.seen.filter((request) => request.method !== "GET" && request.path !== "/oauth2/token")).toEqual([]);
  });

  it("reports a 404 that names no missing bot, as from a harness without the read, as a bad gateway", async () => {
    const token = tokens();
    fake = startFake(
      (request) =>
        token(request) ??
        json(404, {
          message: "Route GET:/v1/provisioning/assistants/%40dwho%3Aexample.com not found",
          error: "Not Found",
          statusCode: 404,
        }),
    );

    await expect(serviceOf(settings(fake.url)).find(OWNER, "syt_owner")).rejects.toMatchObject({
      code: BAD_GATEWAY,
    });
  });

  it("reads again while the harness prepares the bot it has, as the harness says when", async () => {
    const token = tokens();
    let asked = 0;
    fake = startFake((request) => {
      const grant = token(request);
      if (grant) return grant;
      asked += 1;
      return asked < 3
        ? json(
            503,
            {
              error: "not_ready",
            },
            {
              "Retry-After": "0",
            },
          )
        : json(200, BOT);
    });

    const bot = await serviceOf(
      settings(fake.url, {
        ready_timeout_ms: 5000,
      }),
    ).find(OWNER, "syt_owner");

    expect(bot).toEqual(BOT);
    expect(fake.seen.filter((request) => request.path === OWNER_PATH).map((request) => request.method)).toEqual([
      "GET",
      "GET",
      "GET",
    ]);
  });

  it("says of the bot it reads what provisioning says: awaiting recovery, owner not served, not ready", async () => {
    const token = tokens();
    let answer = json(409, {
      error: "recovery_needed",
    });
    fake = startFake((request) => token(request) ?? answer);
    const service = serviceOf(
      settings(fake.url, {
        ready_timeout_ms: 300,
      }),
    );

    await expect(service.find(OWNER, "syt_owner")).rejects.toMatchObject({
      code: BOT_RECOVERY_NEEDED,
    });
    answer = json(422, {
      error: "owner not on the homeserver",
    });
    await expect(service.find(OWNER, "syt_owner")).rejects.toMatchObject({
      code: UNPROCESSABLE,
    });
    answer = json(503, {
      error: "not_ready",
    });
    await expect(service.find(OWNER, "syt_owner")).rejects.toMatchObject({
      code: SERVICE_UNAVAILABLE,
    });
  });

  it("reports a read the harness fails, or a harness it cannot reach, as a bad gateway", async () => {
    const { logger, lines } = capturing();
    const token = tokens();
    fake = startFake(
      (request) =>
        token(request) ??
        json(500, {
          error: "boom",
        }),
    );
    const service = serviceOf(settings(fake.url), logger);

    await expect(service.find(OWNER, "syt_owner")).rejects.toMatchObject({
      code: BAD_GATEWAY,
    });
    fake.stop();
    await expect(service.find(OWNER, "syt_owner")).rejects.toMatchObject({
      code: BAD_GATEWAY,
    });
    expect(lines.some((line) => line.includes("GET /v1/provisioning/assistants/{owner}: 500"))).toBe(true);
    expect(lines.filter((line) => line.includes("dwho"))).toEqual([]);
  });

  it("asks the harness for the owner's recovery, and says when the owner has no bot", async () => {
    const token = tokens();
    let known = true;
    fake = startFake((request) => {
      const answer = token(request);
      if (answer) return answer;
      return known
        ? json(202, {
            queued: true,
          })
        : json(404, {
            error: "no assistant",
          });
    });
    const service = serviceOf(settings(fake.url));

    await service.recover(OWNER);
    known = false;
    await expect(service.recover(OWNER)).rejects.toMatchObject({
      code: NOT_FOUND,
    });
    const asked = fake.seen.filter((request) => request.path !== "/oauth2/token");
    expect(
      asked.map((request) => [
        request.method,
        request.path,
      ]),
    ).toEqual([
      [
        "POST",
        `${OWNER_PATH}/recover`,
      ],
      [
        "POST",
        `${OWNER_PATH}/recover`,
      ],
    ]);
    expect(asked[0]?.authorization).toBe("Bearer tok-1");
  });

  it("reads and turns the owner's suggestions at the harness, and reports nonsense as a bad gateway", async () => {
    const token = tokens();
    let enabled = true;
    fake = startFake((request) => {
      const answer = token(request);
      if (answer) return answer;
      if (request.method === "PUT") enabled = JSON.parse(request.body).enabled;
      return json(200, {
        enabled,
      });
    });
    const service = serviceOf(settings(fake.url));

    expect(await service.readSuggestions(OWNER)).toBe(true);
    expect(await service.writeSuggestions(OWNER, false)).toBe(false);
    expect(await service.readSuggestions(OWNER)).toBe(false);
    const asked = fake.seen.filter((request) => request.path !== "/oauth2/token");
    expect(
      asked.map((request) => [
        request.method,
        request.path,
        request.body,
      ]),
    ).toEqual([
      [
        "GET",
        `${OWNER_PATH}/suggestions`,
        "",
      ],
      [
        "PUT",
        `${OWNER_PATH}/suggestions`,
        '{"enabled":false}',
      ],
      [
        "GET",
        `${OWNER_PATH}/suggestions`,
        "",
      ],
    ]);

    fake.stop();
    fake = startFake((request) => token(request) ?? json(200, {}));
    await expect(serviceOf(settings(fake.url)).readSuggestions(OWNER)).rejects.toMatchObject({
      code: BAD_GATEWAY,
    });
  });

  it("reports a harness that fails, answers nonsense or cannot be reached as a bad gateway", async () => {
    const token = tokens();
    let answer = json(500, {
      error: "boom",
    });
    fake = startFake((request) => token(request) ?? answer);
    const service = serviceOf(settings(fake.url));

    await expect(service.provision(OWNER, "syt_owner")).rejects.toMatchObject({
      code: BAD_GATEWAY,
    });
    answer = json(200, {
      userId: BOT.userId,
    });
    await expect(service.provision(OWNER, "syt_owner")).rejects.toMatchObject({
      code: BAD_GATEWAY,
    });
    fake.stop();
    await expect(service.provision(OWNER, "syt_owner")).rejects.toMatchObject({
      code: BAD_GATEWAY,
    });
  });

  it("keeps its token across calls, and takes a new one once when the harness refuses it", async () => {
    const token = tokens();
    fake = startFake(
      (request) =>
        token(request) ??
        (request.authorization === "Bearer tok-1"
          ? json(401, {
              error: "expired",
            })
          : json(200, BOT)),
    );
    const service = serviceOf(settings(fake.url));

    expect(await service.provision(OWNER, "syt_owner")).toEqual(BOT);
    expect(await service.provision(OWNER, "syt_owner")).toEqual(BOT);

    expect(fake.seen.map((request) => `${request.path} ${request.authorization ?? ""}`.trim())).toEqual([
      `/oauth2/token Basic ${Buffer.from("tom:s3cret").toString("base64")}`,
      `${OWNER_PATH} Bearer tok-1`,
      `/oauth2/token Basic ${Buffer.from("tom:s3cret").toString("base64")}`,
      `${OWNER_PATH} Bearer tok-2`,
      `${OWNER_PATH} Bearer tok-2`,
    ]);
  });

  it("reports a harness that keeps refusing ToM's client as a bad gateway", async () => {
    const token = tokens();
    fake = startFake(
      (request) =>
        token(request) ??
        json(403, {
          error: "client not allowed",
        }),
    );

    await expect(serviceOf(settings(fake.url)).provision(OWNER, "syt_owner")).rejects.toMatchObject({
      code: BAD_GATEWAY,
    });
  });

  it("hands the direct room the client opened to the harness, as the room of the bot", async () => {
    const token = tokens();
    fake = startFake(
      (request) =>
        token(request) ??
        new Response(null, {
          status: 204,
        }),
    );

    await serviceOf(settings(fake.url)).setHome(OWNER, "!dm:example.com");

    const put = fake.seen[1];
    expect(put?.method).toBe("PUT");
    expect(put?.path).toBe(`${OWNER_PATH}/home`);
    expect(put?.authorization).toBe("Bearer tok-1");
    expect(JSON.parse(put?.body ?? "")).toEqual({
      roomId: "!dm:example.com",
    });
  });

  it("waits for the bot to join the room before it is its home, and says when there is no bot", async () => {
    const token = tokens();
    let asked = 0;
    let missing = false;
    fake = startFake((request) => {
      const grant = token(request);
      if (grant) return grant;
      if (missing) {
        return json(404, {
          error: "no assistant",
        });
      }
      asked += 1;
      return asked < 3
        ? json(
            409,
            {
              error: "not a member",
            },
            {
              "Retry-After": "0",
            },
          )
        : new Response(null, {
            status: 204,
          });
    });
    const service = serviceOf(
      settings(fake.url, {
        ready_timeout_ms: 5000,
      }),
    );

    await service.setHome(OWNER, "!dm:example.com");
    expect(asked).toBe(3);

    missing = true;
    await expect(service.setHome(OWNER, "!dm:example.com")).rejects.toMatchObject({
      code: NOT_FOUND,
    });
  });

  it("tells the client to come back when the bot has still not joined the room at the deadline", async () => {
    const token = tokens();
    fake = startFake(
      (request) =>
        token(request) ??
        json(409, {
          error: "not a member",
        }),
    );

    await expect(
      serviceOf(
        settings(fake.url, {
          ready_timeout_ms: 300,
        }),
      ).setHome(OWNER, "!dm:example.com"),
    ).rejects.toMatchObject({
      code: SERVICE_UNAVAILABLE,
    });
  });

  it("refuses a room someone else is in at once: that 409 does not pass", async () => {
    const token = tokens();
    let asked = 0;
    fake = startFake((request) => {
      const grant = token(request);
      if (grant) return grant;
      asked += 1;
      return json(409, {
        error: "not a direct room",
      });
    });

    await expect(
      serviceOf(
        settings(fake.url, {
          ready_timeout_ms: 5000,
        }),
      ).setHome(OWNER, "!group:example.com"),
    ).rejects.toMatchObject({
      code: UNPROCESSABLE,
    });
    expect(asked).toBe(1);
  });

  it("reports an OIDC provider that refuses ToM's client as a bad gateway, and calls no harness", async () => {
    fake = startFake((request) =>
      request.path === "/oauth2/token"
        ? json(401, {
            error: "invalid_client",
          })
        : json(200, BOT),
    );

    await expect(serviceOf(settings(fake.url)).provision(OWNER, "syt_owner")).rejects.toMatchObject({
      code: BAD_GATEWAY,
    });
    expect(fake.seen.map((request) => request.path)).toEqual([
      "/oauth2/token",
    ]);
  });
});
