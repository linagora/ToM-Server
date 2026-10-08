import { beforeAll, describe, expect, it } from "bun:test";
import { join } from "node:path";

import type { RequestHandler } from "express";
import express from "express";
import request from "supertest";
import { createLogger } from "winston";

import type { DomainError } from "../../errors/domain-error";
import { errorMiddleware } from "../../errors/error-middleware";
import { loadMessages } from "../../i18n/index";
import type { AuthenticatedRequest } from "../../middleware/auth/types";
import {
  BotNotProvisionedError,
  BotNotReadyError,
  BotOwnerNotServedError,
  BotRecoveryNeededError,
  BotsUpstreamError,
} from "./errors";
import { createBotsRouter, MY_BOT_HOME_ROUTE, MY_BOT_RECOVER_ROUTE, MY_BOT_ROUTE } from "./router";
import type { BotsService } from "./service";
import type { BotsSettings } from "./types";

const silentLogger = createLogger({
  silent: true,
});

const settings = (enabled: boolean): BotsSettings => ({
  enabled,
  backend: "hermes",
  hermes_profiles_dir: "/tmp/profiles",
  hermes_home: "/opt/data",
  model: {
    provider: "openrouter",
    name: "model",
  },
  bot_localpart_prefix: "bot_",
  device_id_prefix: "HERMES",
  commands: [],
  timeout_ms: 1000,
  ready_timeout_ms: 0,
  publish_interval_ms: 60000,
});

const authenticated: RequestHandler = (req: AuthenticatedRequest, _res, next): void => {
  req.userId = "@dwho:example.com";
  req.accessToken = "syt_owner";
  next();
};

const rejecting: RequestHandler = (_req, res): void => {
  res.status(401).json({
    errcode: "M_UNAUTHORIZED",
    error: "Unauthorized",
  });
};

/** The router behind the app's own error answers, as ToM mounts it. */
const makeApp = (router: express.Router): express.Express => {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use(
    errorMiddleware({
      locale: "en",
    }),
  );
  return app;
};

const serviceAnswering = (bot: unknown): BotsService =>
  ({
    provision: () => Promise.resolve(bot),
  }) as unknown as BotsService;

describe("bots router", () => {
  beforeAll(() => {
    loadMessages(join(import.meta.dir, "../../../assets/i18n"), silentLogger);
  });

  it("answers 404 when the assistants are disabled, so that the client hides the action", async () => {
    const app = makeApp(createBotsRouter(settings(false), undefined, undefined, silentLogger));

    const response = await request(app).post(MY_BOT_ROUTE);

    expect(response.status).toBe(404);
    expect(response.body.errcode).toBe("M_NOT_FOUND");
  });

  it("answers the bot of the authenticated user", async () => {
    const bot = {
      userId: "@bot_dwho:example.com",
      deviceId: "HERMESDWHO",
      masterKey: "mk",
    };
    const app = makeApp(
      createBotsRouter(
        settings(true),
        {
          authenticate: authenticated,
        },
        serviceAnswering(bot),
        silentLogger,
      ),
    );

    const response = await request(app).post(MY_BOT_ROUTE);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(bot);
  });

  it("reads the bot of the authenticated user, without provisioning one", async () => {
    const bot = {
      userId: "@bot_dwho:example.com",
      deviceId: "HERMESDWHO",
      masterKey: "mk",
    };
    const asked: string[][] = [];
    const service = {
      find: (ownerId: string, ownerToken: string) => {
        asked.push([
          ownerId,
          ownerToken,
        ]);
        return Promise.resolve(bot);
      },
    } as unknown as BotsService;
    const app = makeApp(
      createBotsRouter(
        settings(true),
        {
          authenticate: authenticated,
        },
        service,
        silentLogger,
      ),
    );

    const response = await request(app).get(MY_BOT_ROUTE);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(bot);
    expect(asked).toEqual([
      [
        "@dwho:example.com",
        "syt_owner",
      ],
    ]);
  });

  it("says the user has no assistant with its own code, apart from assistants that are off", async () => {
    const service = {
      find: () => Promise.resolve(null),
    } as unknown as BotsService;
    const app = makeApp(
      createBotsRouter(
        settings(true),
        {
          authenticate: authenticated,
        },
        service,
        silentLogger,
      ),
    );
    const disabled = makeApp(createBotsRouter(settings(false), undefined, undefined, silentLogger));

    const none = await request(app).get(MY_BOT_ROUTE);
    const off = await request(disabled).get(MY_BOT_ROUTE);

    expect(none.status).toBe(404);
    expect(none.body.errcode).toBe("M_BOT_NOT_FOUND");
    expect(none.body.error).toBe("The user has no assistant");
    expect(off.status).toBe(404);
    expect(off.body.errcode).toBe("M_NOT_FOUND");
  });

  /** Why a backend cannot answer the bot, and the status and code the client gets for it. */
  const failures: [
    string,
    DomainError,
    number,
    string,
  ][] = [
    [
      "awaits its owner's recovery",
      new BotRecoveryNeededError("bots.recovery_needed"),
      422,
      "M_BOT_RECOVERY_NEEDED",
    ],
    [
      "is not ready yet",
      new BotNotReadyError("bots.not_ready"),
      503,
      "M_SERVICE_UNAVAILABLE",
    ],
    [
      "belongs to an owner the harness does not serve",
      new BotOwnerNotServedError("bots.owner_not_served"),
      422,
      "M_UNPROCESSABLE",
    ],
    [
      "sits behind a harness out of reach",
      new BotsUpstreamError("bots.harness_failure"),
      502,
      "M_BAD_GATEWAY",
    ],
  ];

  it.each(failures)("answers the GET of a bot that %s as it answers the POST", async (_why, error, status, errcode) => {
    const service = {
      find: () => Promise.reject(error),
      provision: () => Promise.reject(error),
    } as unknown as BotsService;
    const app = makeApp(
      createBotsRouter(
        settings(true),
        {
          authenticate: authenticated,
        },
        service,
        silentLogger,
      ),
    );

    const found = await request(app).get(MY_BOT_ROUTE);
    const provisioned = await request(app).post(MY_BOT_ROUTE);

    expect(found.status).toBe(status);
    expect(found.body.errcode).toBe(errcode);
    expect(provisioned.status).toBe(status);
    expect(provisioned.body.errcode).toBe(errcode);
  });

  it("hands the timezone of the browser to the service, and drops one that is not a zone name", async () => {
    const timezones: (string | undefined)[] = [];
    const service = {
      provision: (_owner: string, _token: string, timezone?: string) => {
        timezones.push(timezone);
        return Promise.resolve({});
      },
    } as unknown as BotsService;
    const app = makeApp(
      createBotsRouter(
        settings(true),
        {
          authenticate: authenticated,
        },
        service,
        silentLogger,
      ),
    );

    await request(app).post(MY_BOT_ROUTE).send({
      timezone: "Europe/Paris",
    });
    const injected = await request(app).post(MY_BOT_ROUTE).send({
      timezone: "UTC\nmodel: evil",
    });
    await request(app).post(MY_BOT_ROUTE);

    expect(injected.status).toBe(200);
    expect(timezones).toEqual([
      "Europe/Paris",
      undefined,
      undefined,
    ]);
  });

  it("refuses a request without a valid token", async () => {
    const app = makeApp(
      createBotsRouter(
        settings(true),
        {
          authenticate: rejecting,
        },
        serviceAnswering({}),
        silentLogger,
      ),
    );

    expect((await request(app).post(MY_BOT_ROUTE)).status).toBe(401);
    expect((await request(app).get(MY_BOT_ROUTE)).status).toBe(401);
  });

  it("takes the direct room of the user as the home channel of the bot", async () => {
    const homes: [
      string,
      string,
    ][] = [];
    const service = {
      setHome: (ownerId: string, roomId: string) => {
        homes.push([
          ownerId,
          roomId,
        ]);
      },
    } as unknown as BotsService;
    const app = makeApp(
      createBotsRouter(
        settings(true),
        {
          authenticate: authenticated,
        },
        service,
        silentLogger,
      ),
    );

    const accepted = await request(app).post(MY_BOT_HOME_ROUTE).send({
      room_id: "!dm:example.com",
    });
    const refused = await request(app).post(MY_BOT_HOME_ROUTE).send({
      room_id: "not a room",
    });

    expect(accepted.status).toBe(204);
    expect(refused.status).toBe(400);
    expect(homes).toEqual([
      [
        "@dwho:example.com",
        "!dm:example.com",
      ],
    ]);
  });

  it("answers the home channel once a backend that takes its time has it, and with its refusal", async () => {
    let known = true;
    const service = {
      setHome: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (!known) throw new BotNotProvisionedError("bots.not_provisioned");
      },
    } as unknown as BotsService;
    const app = makeApp(
      createBotsRouter(
        settings(true),
        {
          authenticate: authenticated,
        },
        service,
        silentLogger,
      ),
    );

    const accepted = await request(app).post(MY_BOT_HOME_ROUTE).send({
      room_id: "!dm:example.com",
    });
    known = false;
    const unknown = await request(app).post(MY_BOT_HOME_ROUTE).send({
      room_id: "!dm:example.com",
    });

    expect(accepted.status).toBe(204);
    expect(unknown.status).toBe(404);
  });

  it("asks for the recovery of the bot of the authenticated user", async () => {
    const asked: string[] = [];
    const service = {
      recover: (ownerId: string) => {
        asked.push(ownerId);
      },
    } as unknown as BotsService;
    const app = makeApp(
      createBotsRouter(
        settings(true),
        {
          authenticate: authenticated,
        },
        service,
        silentLogger,
      ),
    );
    const disabled = makeApp(createBotsRouter(settings(false), undefined, undefined, silentLogger));

    expect((await request(app).post(MY_BOT_RECOVER_ROUTE)).status).toBe(202);
    expect((await request(disabled).post(MY_BOT_RECOVER_ROUTE)).status).toBe(404);
    expect(asked).toEqual([
      "@dwho:example.com",
    ]);
  });
});
