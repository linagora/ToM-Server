import { afterEach, describe, expect, it, type Mock, mock } from "bun:test";

import type { RequestHandler } from "express";
import express from "express";
import request from "supertest";
import { createLogger } from "winston";

import { BAD_GATEWAY, NOT_FOUND } from "../../errors/error-codes";
import type { AuthenticatedRequest } from "../../middleware/auth/types";
import { createVisioRouter } from "./router";
import type { VisioDeps, VisioSettings } from "./types";

const ROUTE = "/_twake/v1/video_call/rooms";
const ROOM_URL = "https://visio.example.com/abc-defg-hij";

const STATUS: Record<string, number> = {
  [NOT_FOUND]: 404,
  [BAD_GATEWAY]: 502,
};

const enabledConfig: VisioSettings = {
  enabled: true,
  base_url: "https://visio.example.com",
  client_id: "tom",
  client_secret: "s3cret",
  timeout_ms: 1000,
};

interface MockedDeps extends VisioDeps {
  authenticate: Mock<RequestHandler>;
  resolveEmail: Mock<VisioDeps["resolveEmail"]>;
}

const authenticated: RequestHandler = (
  req: AuthenticatedRequest,
  _res: express.Response,
  next: express.NextFunction,
): void => {
  req.userId = "@dwho:example.com";
  next();
};

const rejecting: RequestHandler = (_req: express.Request, res: express.Response): void => {
  res.status(401).json({
    errcode: "M_UNAUTHORIZED",
    error: "Unauthorized",
  });
};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
  });

const mockFetch = (...responses: Response[]): Mock<() => Promise<Response>> => {
  const fetchMock: Mock<() => Promise<Response>> = mock();
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response);
  }
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  return fetchMock;
};

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: test suite
describe("VisioRouter", () => {
  const silentLogger = createLogger({
    silent: true,
  });
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const setupDeps = (authenticate: RequestHandler = authenticated): MockedDeps => ({
    authenticate: mock(authenticate),
    resolveEmail: mock(() => Promise.resolve<string | null>("dwho@example.com")),
  });

  const setupApp = (config: VisioSettings, deps: VisioDeps | undefined): express.Express => {
    const app = express();
    app.use(createVisioRouter(config, deps, silentLogger));

    // biome-ignore lint/suspicious/noExplicitAny: Express err is loosely typed
    app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(STATUS[err.code] ?? 500).json({
        code: err.code,
      });
    });
    return app;
  };

  it("should return 404 without authenticating when the module is disabled", async () => {
    // Arrange
    const fetchMock = mockFetch();
    const deps = setupDeps();
    const app = setupApp(
      {
        enabled: false,
        timeout_ms: 1000,
      },
      deps,
    );

    // Act
    const response = await request(app).post(ROUTE).send({});

    // Assert
    expect(response.status).toBe(404);
    expect(response.body.code).toBe(NOT_FOUND);
    expect(deps.authenticate).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("should return 404 when the legacy dependencies are unavailable", async () => {
    // Arrange
    const fetchMock = mockFetch();
    const app = setupApp(enabledConfig, undefined);

    // Act
    const response = await request(app).post(ROUTE).send({});

    // Assert
    expect(response.status).toBe(404);
    expect(response.body.code).toBe(NOT_FOUND);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("should authenticate then return 201 with the room url", async () => {
    // Arrange
    mockFetch(
      json(200, {
        access_token: "visio-jwt",
      }),
      json(201, {
        slug: "abc-defg-hij",
        url: ROOM_URL,
      }),
    );
    const deps = setupDeps();
    const app = setupApp(enabledConfig, deps);

    // Act
    const response = await request(app).post(ROUTE).set("Authorization", "Bearer matrix-token").send({});

    // Assert
    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      url: ROOM_URL,
    });
    expect(deps.authenticate).toHaveBeenCalledTimes(1);
    expect(deps.resolveEmail).toHaveBeenCalledTimes(1);
  });

  it("should return 404 when the user has no email", async () => {
    // Arrange
    const fetchMock = mockFetch();
    const deps = setupDeps();
    deps.resolveEmail.mockResolvedValueOnce(null);
    const app = setupApp(enabledConfig, deps);

    // Act
    const response = await request(app).post(ROUTE).send({});

    // Assert
    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("should return 404 when the service does not know the user", async () => {
    // Arrange
    mockFetch(
      json(404, {
        detail: "User not found.",
      }),
    );
    const app = setupApp(enabledConfig, setupDeps());

    // Act
    const response = await request(app).post(ROUTE).send({});

    // Assert
    expect(response.status).toBe(404);
    expect(response.body.code).toBe(NOT_FOUND);
  });

  it("should return 502 when the service fails", async () => {
    // Arrange
    mockFetch(
      json(401, {
        detail: "Invalid credentials",
      }),
    );
    const app = setupApp(enabledConfig, setupDeps());

    // Act
    const response = await request(app).post(ROUTE).send({});

    // Assert
    expect(response.status).toBe(502);
    expect(response.body.code).toBe(BAD_GATEWAY);
  });

  it("should return 401 and skip the service when the authenticator rejects", async () => {
    // Arrange
    const fetchMock = mockFetch();
    const deps = setupDeps(rejecting);
    const app = setupApp(enabledConfig, deps);

    // Act
    const response = await request(app).post(ROUTE).send({});

    // Assert
    expect(response.status).toBe(401);
    expect(deps.resolveEmail).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
