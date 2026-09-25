/**
 * @file Express app factory.
 *
 * Mounts global middleware, telemetry endpoints, OpenAPI, module routers,
 * and the terminal error handler. Returns the app instance — never starts
 * listening. That is server.ts's job.
 */
import type { PrometheusExporter } from "@opentelemetry/exporter-prometheus";
import type { Express } from "express";
import express from "express";
import type { Logger } from "winston";

import type { Config } from "./config/types";
import { errorMiddleware } from "./errors/error-middleware";
import { MatrixAuth } from "./middleware/auth/index";
import type { AuthenticatedRequest } from "./middleware/auth/types";
import { createCorsMiddleware } from "./middleware/cors";
import { httpLogger } from "./middleware/http-logger";
import { requestId } from "./middleware/request-id";
import { createLandingRouter } from "./modules/landing/router";
import { createLegacyRouter } from "./modules/legacy/router";
import { createVisioRouter } from "./modules/visio/router";
import type { VisioDeps } from "./modules/visio/types";
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

function mountVisio(config: Config, logger: Logger, app: Express): void {
  const visioLogger = logger.child({
    module: "visio",
  });
  let deps: VisioDeps | undefined;
  if (config.visio.enabled) {
    const auth = new MatrixAuth(
      {
        serverUrl: config.synapse.server_url.replace(/\/+$/, ""),
        serverName: config.server.name,
        timeoutMs: config.visio.timeout_ms,
      },
      visioLogger,
    );
    deps = {
      authenticate: auth.middleware(),
      resolveEmail: (req: AuthenticatedRequest): Promise<string | null> =>
        req.accessToken ? auth.resolveEmail(req.accessToken) : Promise.resolve(null),
    };
  }
  logger.info(`Mounting visioRouter... enabled: ${config.visio.enabled}`);
  app.use(createVisioRouter(config.visio, deps, visioLogger));
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

  // --- End of new modules ---

  // --- Module routers ---
  const legacyRouter = await createLegacyRouter(config, logger);
  app.use(legacyRouter);

  // --- Error handler (single, terminal) ---
  app.use(errorMiddleware(config.i18n));

  return app;
}
