import { afterEach, beforeAll, describe, expect, it, type Mock, mock } from "bun:test";

import express from "express";
import request from "supertest";
import { createLogger } from "winston";

import { BAD_GATEWAY, FORBIDDEN, INVALID_INPUT, NOT_FOUND, UNAUTHORIZED } from "../../errors/error-codes";
import { loadMessages } from "../../i18n/index";
import { OpenIdValidator } from "./openid";
import { VisioService } from "./service";
import { createSfuRouter, SFU_ROUTE } from "./sfu-router";
import { SynapseAdmin } from "./synapse-admin";
import type { LivekitSettings, SfuDeps, VisioSettings } from "./types";

const STATUS: Record<string, number> = {
  [INVALID_INPUT]: 400,
  [UNAUTHORIZED]: 401,
  [FORBIDDEN]: 403,
  [NOT_FOUND]: 404,
  [BAD_GATEWAY]: 502,
};

const silentLogger = createLogger({
  silent: true,
});

const livekit: LivekitSettings = {
  enabled: true,
  url: "ws://127.0.0.1:7880",
};

const visio: VisioSettings = {
  enabled: true,
  base_url: "http://meet:8000",
  client_id: "tom",
  client_secret: "s3cret",
  room_access_level: "restricted",
  service_account_email: "visio@twake.test",
  room_configuration: {
    screen_recording_permission: "authenticated",
    transcript_permission: "authenticated",
    everyone_can_mute: false,
  },
  timeout_ms: 1000,
};

const body = {
  room: "!room:localhost",
  openid_token: {
    access_token: "openid-token",
    token_type: "Bearer",
    matrix_server_name: "localhost",
    expires_in: 3600,
  },
  device_id: "DEVICE",
};

const json = (status: number, payload: unknown): Response =>
  new Response(JSON.stringify(payload), {
    status,
  });

const userInfo = (): Response =>
  json(200, {
    sub: "@alice:localhost",
  });
const members = (): Response =>
  json(200, {
    members: [
      "@alice:localhost",
    ],
    total: 1,
  });
const profile = (): Response =>
  json(200, {
    displayname: "Alice",
    threepids: [
      {
        medium: "email",
        address: "alice@twake.test",
      },
    ],
    external_ids: [],
  });
const moderators = (): Response =>
  json(200, {
    state: [
      {
        type: "m.room.power_levels",
        content: {
          users: {
            "@alice:localhost": 50,
          },
        },
      },
    ],
  });
const appToken = (): Response =>
  json(200, {
    access_token: "meet-app-jwt",
  });
const meetRoom = (): Response =>
  json(201, {
    id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    slug: "abc-defg-hij",
  });
const meetToken = (): Response =>
  json(200, {
    url: "http://synapse:7880",
    room: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    token: "meet-livekit-jwt",
  });

type FetchMock = Mock<(url: string, init: RequestInit) => Promise<Response>>;

const mockFetch = (...results: Response[]): FetchMock => {
  const fetchMock: FetchMock = mock();
  for (const result of results) {
    fetchMock.mockResolvedValueOnce(result);
  }
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  return fetchMock;
};

const makeDeps = (): SfuDeps => ({
  openId: new OpenIdValidator(
    {
      serverUrl: "https://localhost:8448",
      serverName: "localhost",
      timeoutMs: 1000,
    },
    silentLogger,
  ),
  admin: new SynapseAdmin(
    {
      serverUrl: "https://localhost:8448",
      timeoutMs: 1000,
      admin: {
        login: "",
        password: "",
        accessToken: "admin-token",
      },
    },
    silentLogger,
  ),
  service: new VisioService(visio, silentLogger),
});

const setupApp = (deps: SfuDeps | undefined, settings: LivekitSettings = livekit): express.Express => {
  const app = express();
  app.use(express.json());
  app.use(createSfuRouter(settings, deps, silentLogger));
  // biome-ignore lint/suspicious/noExplicitAny: Express err is loosely typed
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(STATUS[err.code] ?? 500).json({
      code: err.code,
    });
  });

  return app;
};

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: test suite
describe("SfuRouter", () => {
  const originalFetch = globalThis.fetch;

  beforeAll(() => {
    loadMessages("assets/i18n", silentLogger);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should answer 404 when LiveKit is not configured", async () => {
    // Arrange
    const fetchMock = mockFetch();
    const app = setupApp(undefined, {
      enabled: false,
    });

    // Act
    const response = await request(app).post(SFU_ROUTE).send(body);

    // Assert
    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("should answer 400 for a request that is not MSC4195", async () => {
    // Arrange
    mockFetch();

    // Act
    const response = await request(app()).post(SFU_ROUTE).send({
      room: "!room:localhost",
    });

    // Assert
    expect(response.status).toBe(400);
    expect(response.body.code).toBe(INVALID_INPUT);
  });

  it("should answer 404 and no token when visio is disabled", async () => {
    // Arrange
    const fetchMock = mockFetch();

    // Act: livekit on, but no Meet behind it
    const response = await request(setupApp(undefined)).post(SFU_ROUTE).send(body);

    // Assert
    expect(response.status).toBe(404);
    expect(response.body.jwt).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("should answer 502 and no token when Meet does not answer", async () => {
    // Arrange: the user checks pass, then the application token of the service account fails
    mockFetch(
      userInfo(),
      members(),
      profile(),
      moderators(),
      json(502, {
        error: "down",
      }),
    );

    // Act
    const response = await request(app()).post(SFU_ROUTE).send(body);

    // Assert
    expect(response.status).toBe(502);
    expect(response.body.code).toBe(BAD_GATEWAY);
    expect(response.body.jwt).toBeUndefined();
  });

  it("should make the Meet room once, then let Meet mint the token with the identity of the device", async () => {
    // Arrange
    const fetchMock = mockFetch(
      userInfo(),
      members(),
      profile(),
      moderators(),
      appToken(), // service account
      meetRoom(),
      appToken(), // alice
      meetToken(),
    );
    const deps = makeDeps();

    // Act
    const response = await request(setupApp(deps)).post(SFU_ROUTE).send(body);

    // Assert
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      url: "ws://127.0.0.1:7880",
      jwt: "meet-livekit-jwt",
    });
    const calls = fetchMock.mock.calls.map(([url]) => url);
    expect(calls[4]).toBe("http://meet:8000/external-api/v1.0/application/token/");
    expect(JSON.parse(String(fetchMock.mock.calls[4]?.[1].body)).scope).toBe("visio@twake.test");
    expect(calls[5]).toBe("http://meet:8000/external-api/v1.0/rooms/");
    expect(JSON.parse(String(fetchMock.mock.calls[5]?.[1].body))).toEqual({
      access_level: "restricted",
      configuration: visio.room_configuration,
    });
    expect(JSON.parse(String(fetchMock.mock.calls[6]?.[1].body)).scope).toBe("alice@twake.test");
    expect(calls[7]).toBe(
      "http://meet:8000/external-api/v1.0/rooms/7c9e6679-7425-40de-944b-e07fc1f90ae7/livekit-token/",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[7]?.[1].body))).toEqual({
      identity: "@alice:localhost:DEVICE",
      username: "Alice",
      role: "administrator",
    });
    expect((fetchMock.mock.calls[7]?.[1]?.headers as Record<string, string> | undefined)?.Authorization).toBe(
      "Bearer meet-app-jwt",
    );

    // The room is made once: a second request mints only
    mockFetch(userInfo(), members(), profile(), moderators(), appToken(), meetToken());
    const second = await request(setupApp(deps)).post(SFU_ROUTE).send(body);
    expect(second.status).toBe(200);
  });

  it("should answer 502 when Meet fails after the room was made", async () => {
    // Arrange
    const deps = makeDeps();
    mockFetch(userInfo(), members(), profile(), moderators(), appToken(), meetRoom(), appToken(), meetToken());
    await request(setupApp(deps)).post(SFU_ROUTE).send(body);
    mockFetch(
      userInfo(),
      members(),
      profile(),
      moderators(),
      json(502, {
        error: "down",
      }),
    );

    // Act
    const response = await request(setupApp(deps)).post(SFU_ROUTE).send(body);

    // Assert
    expect(response.status).toBe(502);
    expect(response.body.jwt).toBeUndefined();
  });

  it("should answer 404 for a participant without an email", async () => {
    // Arrange
    const fetchMock = mockFetch(
      userInfo(),
      members(),
      json(200, {
        displayname: "Alice",
        threepids: [],
        external_ids: [],
      }),
      moderators(),
    );

    // Act
    const response = await request(app()).post(SFU_ROUTE).send(body);

    // Assert: no room made for nothing
    expect(response.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it.each([
    // A Meet without the livekit-token route answers Django's HTML 404
    [
      "has no route to mint the token",
      "<h1>Not Found</h1>",
      "text/html; charset=utf-8",
    ],
    // A room Meet no longer has, or keeps for another application
    [
      "refuses the room",
      '{"detail":"Not found."}',
      "application/json",
    ],
  ])("should answer 502 when Meet %s", async (_case, notFound, contentType) => {
    // Arrange
    mockFetch(
      userInfo(),
      members(),
      profile(),
      moderators(),
      appToken(),
      meetRoom(),
      appToken(),
      new Response(notFound, {
        status: 404,
        headers: {
          "content-type": contentType,
        },
      }),
    );

    // Act
    const response = await request(app()).post(SFU_ROUTE).send(body);

    // Assert
    expect(response.status).toBe(502);
    expect(response.body.jwt).toBeUndefined();
  });

  it("should answer 403 when the user is not a member of the room", async () => {
    // Arrange
    mockFetch(
      userInfo(),
      json(200, {
        members: [
          "@bob:localhost",
        ],
        total: 1,
      }),
    );

    // Act
    const response = await request(app()).post(SFU_ROUTE).send(body);

    // Assert
    expect(response.status).toBe(403);
    expect(response.body.code).toBe(FORBIDDEN);
  });

  it("should answer 401 when the OpenID token is rejected", async () => {
    // Arrange
    mockFetch(json(401, {}));

    // Act
    const response = await request(app()).post(SFU_ROUTE).send(body);

    // Assert
    expect(response.status).toBe(401);
    expect(response.body.code).toBe(UNAUTHORIZED);
  });

  it("should answer 403 for a token of another homeserver", async () => {
    // Act
    const response = await request(app())
      .post(SFU_ROUTE)
      .send({
        ...body,
        openid_token: {
          ...body.openid_token,
          matrix_server_name: "elsewhere.org",
        },
      });

    // Assert
    expect(response.status).toBe(403);
  });

  function app(): express.Express {
    return setupApp(makeDeps());
  }
});
