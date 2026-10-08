/**
 * @file Express app factory.
 *
 * Mounts global middleware, telemetry endpoints, OpenAPI, module routers,
 * and the terminal error handler. Returns the app instance — never starts
 * listening. That is server.ts's job.
 */
import type { PrometheusExporter } from "@opentelemetry/exporter-prometheus";
import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import express from "express";
import { rateLimit } from "express-rate-limit";
import type { Logger } from "winston";

import type { Config } from "./config/types";
import { errorMiddleware } from "./errors/error-middleware";
import { translate } from "./i18n/index";
import { TokenValidator } from "./middleware/auth/index";
import type { AuthenticatedRequest } from "./middleware/auth/types";
import { createCorsMiddleware } from "./middleware/cors";
import { httpLogger } from "./middleware/http-logger";
import { requestId } from "./middleware/request-id";
import { makeBotsBackend } from "./modules/bots/backend";
import { createBotsRouter } from "./modules/bots/router";
import type { BotsDeps, BotsProvisioner } from "./modules/bots/types";
import { GifsDisabledError } from "./modules/gifs/errors";
import { DbGifsFlag, FLAGS_SCHEMA } from "./modules/gifs/flag";
import { createGifsRouter } from "./modules/gifs/router";
import { GifsService } from "./modules/gifs/service";
import type { GifsDeps } from "./modules/gifs/types";
import { createLandingRouter } from "./modules/landing/router";
import Database from "./modules/legacy/db/database";
import { createLegacyRouter, mapToLegacyConfig } from "./modules/legacy/router";
import AdminSettingsMiddleware from "./modules/legacy/tom-server/admin-settings-api/middlewares";
import { createPublicPagesRouter } from "./modules/public-pages/router";
import { makeSynapseSource } from "./modules/public-pages/source";
import { EmailResolver } from "./modules/visio/email-resolver";
import { OpenIdValidator } from "./modules/visio/openid";
import { createVisioRouter } from "./modules/visio/router";
import { VisioService } from "./modules/visio/service";
import { createSfuRouter } from "./modules/visio/sfu-router";
import { SynapseAdmin } from "./modules/visio/synapse-admin";
import type { SfuDeps, VisioDeps } from "./modules/visio/types";
import { createWellKnownClientRouter } from "./modules/well-known/router";

function mountWellKnownClient(config: Config, logger: Logger, app: Express): void {
  const wellKnownRouter = createWellKnownClientRouter(
    {
      enabled: config.well_known.client.enabled, // disabled router will lead to 404
      homeserver: {
        base_url: config.synapse.server_url,
      },
      identityserver: {
        base_url: config.server.base_url,
      },
      tomserver: {
        base_url: config.server.base_url,
        server_name: config.server.name,
      },
      federatedIdentityServices: {
        base_urls: config.federation.identity_services,
      },
      extra: config.well_known.client.extra,
    },
    logger.child({
      module: "well-known-client",
    }),
  );
  logger.info(`Mounting wellKnownRouter... client: ${config.well_known.client.enabled}`);
  app.use(wellKnownRouter);
}

/** The MatrixRTC token service of the calls of Twake Chat (D30): Meet behind it when `visio` is enabled. */
function mountSfu(config: Config, logger: Logger, app: Express): void {
  const sfuLogger = logger.child({
    module: "visio-sfu",
  });
  let deps: SfuDeps | undefined;
  if (config.livekit.enabled) {
    deps = {
      openId: new OpenIdValidator(
        {
          serverUrl: config.synapse.server_url,
          serverName: config.server.name,
          timeoutMs: config.auth.timeout_ms,
        },
        sfuLogger,
      ),
      admin: new SynapseAdmin(
        {
          serverUrl: config.synapse.server_url,
          timeoutMs: config.auth.timeout_ms,
          admin: {
            login: config.synapse.admin?.login ?? "",
            password: config.synapse.admin?.password ?? "",
            accessToken: config.synapse.admin?.access_token ?? "",
          },
        },
        sfuLogger,
      ),
      service: config.visio.enabled ? new VisioService(config.visio, sfuLogger) : undefined,
    };
  }
  logger.info(
    translate("log.visio.sfu_mounting", {
      enabled: String(config.livekit.enabled),
      meet: String(config.livekit.enabled && config.visio.enabled),
    }),
  );
  app.use(createSfuRouter(config.livekit, deps, sfuLogger));
}

function mountVisio(config: Config, logger: Logger, app: Express): void {
  const visioLogger = logger.child({
    module: "visio",
  });
  let deps: VisioDeps | undefined;
  if (config.visio.enabled) {
    const tokenValidator = new TokenValidator(
      {
        serverUrl: config.synapse.server_url,
        serverName: config.server.name,
        timeoutMs: config.auth.timeout_ms,
        tokenCacheSize: config.auth.token_cache_size,
        tokenCacheTtlMs: config.auth.token_cache_ttl_ms,
      },
      visioLogger,
    );
    const emailResolver = new EmailResolver(
      {
        serverUrl: config.synapse.server_url,
        timeoutMs: config.auth.timeout_ms,
      },
      visioLogger,
    );
    deps = {
      authenticate: tokenValidator.middleware(),
      resolveEmail: (req: AuthenticatedRequest): Promise<string | null> =>
        req.accessToken ? emailResolver.resolve(req.accessToken) : Promise.resolve(null),
    };
  }
  logger.info(
    translate("log.visio.mounting", {
      enabled: String(config.visio.enabled),
    }),
  );
  app.use(createVisioRouter(config.visio, deps, visioLogger));
}

function mountBots(config: Config, logger: Logger, app: Express): void {
  const botsLogger = logger.child({
    module: "bots",
  });
  let deps: BotsDeps | undefined;
  let service: BotsProvisioner | undefined;
  if (config.bots.enabled) {
    const tokenValidator = new TokenValidator(
      {
        serverUrl: config.synapse.server_url,
        serverName: config.server.name,
        timeoutMs: config.auth.timeout_ms,
        tokenCacheSize: config.auth.token_cache_size,
        tokenCacheTtlMs: config.auth.token_cache_ttl_ms,
      },
      botsLogger,
    );
    deps = {
      authenticate: tokenValidator.middleware(),
    };
    // Hermes or the agent harness, never both: they would claim the same accounts
    const backend = makeBotsBackend(
      config.bots,
      {
        serverUrl: config.synapse.server_url,
        serverName: config.server.name,
        admin: {
          login: config.synapse.admin?.login ?? "",
          password: config.synapse.admin?.password ?? "",
          accessToken: config.synapse.admin?.access_token ?? "",
        },
      },
      botsLogger,
    );
    service = backend.service;
    backend.commands?.start();
  }
  logger.info(
    translate("log.bots.mounting", {
      enabled: String(config.bots.enabled),
    }),
  );
  app.use(createBotsRouter(config.bots, deps, service, botsLogger));
}

/** GIFs through ToM (Klipy never sees the users); the switch lives in the database of ToM. */
async function mountGifs(config: Config, logger: Logger, app: Express): Promise<void> {
  const gifsLogger = logger.child({
    module: "gifs",
  });
  let deps: GifsDeps | undefined;
  let service: GifsService | undefined;
  if (config.gifs.klipy_api_key) {
    const legacy = mapToLegacyConfig(config);
    const db = new Database<"feature_flags">(legacy, gifsLogger as never, FLAGS_SCHEMA);
    await db.ready;
    const tokenValidator = new TokenValidator(
      {
        serverUrl: config.synapse.server_url,
        serverName: config.server.name,
        timeoutMs: config.auth.timeout_ms,
        tokenCacheSize: config.auth.token_cache_size,
        tokenCacheTtlMs: config.auth.token_cache_ttl_ms,
      },
      gifsLogger,
    );
    const adminCheck = new AdminSettingsMiddleware(legacy, gifsLogger as never).checkAdminSettingsToken;
    deps = {
      authenticate: tokenValidator.middleware(),
      // an empty admin token must never open the admin API
      authenticateAdmin: legacy.admin_access_token
        ? (adminCheck as RequestHandler)
        : (_req: Request, _res: Response, next: NextFunction): void => next(new GifsDisabledError("gifs.disabled")),
      rateLimit: rateLimit({
        windowMs: config.server.rate_limiting.window_ms,
        limit: config.server.rate_limiting.max_requests,
        keyGenerator: (req: Request): string => (req as AuthenticatedRequest).userId ?? "anonymous",
        standardHeaders: true,
        legacyHeaders: false,
        message: {
          errcode: "M_LIMIT_EXCEEDED",
          error: "Too many requests",
        },
      }),
    };
    service = new GifsService(config.gifs, new DbGifsFlag(db), config.server.base_url, gifsLogger);
  }
  logger.info(
    translate("log.gifs.mounting", {
      available: String(service !== undefined),
    }),
  );
  app.use(createGifsRouter(deps, service, gifsLogger));
}

/** The public web pages of the rooms anyone may read; disabled is not mounted, so 404. */
function mountPublicPages(config: Config, logger: Logger, app: Express): void {
  if (!config.public_pages.enabled) {
    return;
  }
  const pagesLogger = logger.child({
    module: "public-pages",
  });
  const admin = config.synapse.admin;
  if (!admin?.access_token && !(admin?.login && admin.password)) {
    pagesLogger.warn(translate("log.public_pages.no_admin"));
    return;
  }
  logger.info(translate("log.public_pages.mounting"));
  const source = makeSynapseSource(
    new SynapseAdmin(
      {
        serverUrl: config.synapse.server_url,
        timeoutMs: config.auth.timeout_ms,
        admin: {
          login: admin.login,
          password: admin.password,
          accessToken: admin.access_token,
        },
      },
      pagesLogger,
    ),
  );
  app.use(
    createPublicPagesRouter(
      config.public_pages,
      {
        source,
        serverName: config.server.name,
      },
      pagesLogger,
    ),
  );
}

export async function createApp(
  config: Config,
  logger: Logger,
  prometheusExporter: PrometheusExporter | undefined,
): Promise<Express> {
  const app = express();

  if (config.server.trust_x_forwarded_for) {
    const hops = config.server.trusted_proxies;
    app.set("trust proxy", hops.length > 0 ? hops : true);
  }

  // --- Global middleware (cross-cutting only) ---
  app.use(createCorsMiddleware(config.cors));
  app.use(express.json());
  app.use(
    express.urlencoded({
      extended: true,
    }),
  );
  app.use(requestId());
  app.use(httpLogger(logger));

  // --- Telemetry: Prometheus metrics endpoint ---
  // PrometheusExporter provides its own Express-compatible handler.
  // Undefined when telemetry is disabled (e.g., in tests).
  if (prometheusExporter) {
    logger.info(`Mounting Prometheus metrics endpoint at ${config.telemetry.metrics_endpoint}`);
    app.get(config.telemetry.metrics_endpoint, prometheusExporter.getMetricsRequestHandler.bind(prometheusExporter));
  }

  // --- Root Landing Page ---
  const landingRouter = createLandingRouter(
    config.landing,
    logger.child({
      module: "landing",
    }),
  );
  if (landingRouter) {
    logger.info("Mounting landing page router");
    app.use(landingRouter);
  }

  // --- New modules routers here ---
  mountWellKnownClient(config, logger, app);
  mountVisio(config, logger, app);
  mountSfu(config, logger, app);
  mountBots(config, logger, app);
  await mountGifs(config, logger, app);
  mountPublicPages(config, logger, app);

  // --- End of new modules ---

  // --- Module routers ---
  const legacyRouter = await createLegacyRouter(config, logger);
  app.use(legacyRouter);

  // --- Error handler (single, terminal) ---
  app.use(errorMiddleware(config.i18n));

  return app;
}
