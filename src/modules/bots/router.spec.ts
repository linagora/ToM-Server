import { beforeAll, describe, expect, it } from "bun:test";

import type { RequestHandler } from "express";
import express from "express";
import request from "supertest";
import { createLogger } from "winston";

import { NOT_FOUND } from "../../errors/error-codes";
import { loadMessages } from "../../i18n/index";
import type { AuthenticatedRequest } from "../../middleware/auth/types";
import { createBotsRouter, MY_BOT_ROUTE } from "./router";
import type { BotsService } from "./service";
import type { BotsSettings } from "./types";

const silentLogger = createLogger({
  silent: true,
});

const settings = (enabled: boolean): BotsSettings => ({
  enabled,
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

const makeApp = (router: express.Router): express.Express => {
  const app = express();
  app.use(router);
  // biome-ignore lint/suspicious/noExplicitAny: Express err is loosely typed
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.code === NOT_FOUND ? 404 : 500).json({
      errcode: err.code,
    });
  });
  return app;
};

const serviceAnswering = (bot: unknown): BotsService =>
  ({
    provision: () => Promise.resolve(bot),
  }) as unknown as BotsService;

describe("bots router", () => {
  beforeAll(() => {
    loadMessages(undefined, silentLogger);
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

    const response = await request(app).post(MY_BOT_ROUTE);

    expect(response.status).toBe(401);
  });
});
