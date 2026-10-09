import { afterEach, beforeAll, describe, expect, it, type Mock, mock } from "bun:test";

import express from "express";
import request from "supertest";
import { createLogger } from "winston";

import { BAD_GATEWAY, FORBIDDEN, INVALID_INPUT, NOT_FOUND, UNAUTHORIZED } from "../../errors/error-codes";
import { loadMessages } from "../../i18n/index";
import { decodeJwtPayload } from "./livekit-token";
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
  api_key: "devkey",
  api_secret: "secret",
  token_ttl_seconds: 3600,
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

const makeDeps = (withMeet: boolean): SfuDeps => ({
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
  service: withMeet ? new VisioService(visio, silentLogger) : undefined,
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
      token_ttl_seconds: 3600,
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
    const response = await request(app(false)).post(SFU_ROUTE).send({
      room: "!room:localhost",
    });

    // Assert
    expect(response.status).toBe(400);
    expect(response.body.code).toBe(INVALID_INPUT);
  });

  it("should sign the token itself for the Matrix room when Meet is not there (degraded mode)", async () => {
    // Arrange
    const fetchMock = mockFetch(userInfo(), members(), profile());

    // Act
    const response = await request(app(false)).post(SFU_ROUTE).send(body);

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.url).toBe("ws://127.0.0.1:7880");
    const claims = decodeJwtPayload(response.body.jwt);
    expect(claims.iss).toBe("devkey");
    expect(claims.sub).toBe("@alice:localhost:DEVICE");
    expect(claims.name).toBe("Alice");
    expect((claims.video as Record<string, unknown>).room).toBe("!room:localhost");
    expect(claims.attributes).toEqual({
      matrix_user_id: "@alice:localhost",
      matrix_device_id: "DEVICE",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
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
    const deps = makeDeps(true);

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
    expect(deps.service?.mappedRoom("!room:localhost")).toBe("7c9e6679-7425-40de-944b-e07fc1f90ae7");
  });

  it("should fall back on signing itself, for the Meet room already made, when Meet fails", async () => {
    // Arrange
    const deps = makeDeps(true);
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
    expect(response.status).toBe(200);
    const claims = decodeJwtPayload(response.body.jwt);
    expect(claims.iss).toBe("devkey");
    expect((claims.video as Record<string, unknown>).room).toBe("7c9e6679-7425-40de-944b-e07fc1f90ae7");
  });

  it("should make the Meet room for a first participant without an email, and sign for it", async () => {
    // Arrange: the one who starts the call has no email, Meet cannot mint for them
    const deps = makeDeps(true);
    mockFetch(
      userInfo(),
      members(),
      json(200, {
        displayname: "Alice",
        threepids: [],
        external_ids: [],
      }),
      moderators(),
      appToken(),
      meetRoom(),
    );

    // Act
    const response = await request(setupApp(deps)).post(SFU_ROUTE).send(body);

    // Assert: the LiveKit room is the Meet room the next ones get from Meet
    expect(response.status).toBe(200);
    const claims = decodeJwtPayload(response.body.jwt);
    expect((claims.video as Record<string, unknown>).room).toBe("7c9e6679-7425-40de-944b-e07fc1f90ae7");
  });

  it("should keep the Meet room when Meet has no route to mint the token", async () => {
    // Arrange: a Meet without the livekit-token route answers Django's HTML 404
    const deps = makeDeps(true);
    mockFetch(
      userInfo(),
      members(),
      profile(),
      moderators(),
      appToken(),
      meetRoom(),
      appToken(),
      new Response("<h1>Not Found</h1>", {
        status: 404,
        headers: {
          "content-type": "text/html; charset=utf-8",
        },
      }),
    );

    // Act
    const response = await request(setupApp(deps)).post(SFU_ROUTE).send(body);

    // Assert: signed by ToM for the room the others get, not made again
    expect(response.status).toBe(200);
    const claims = decodeJwtPayload(response.body.jwt);
    expect((claims.video as Record<string, unknown>).room).toBe("7c9e6679-7425-40de-944b-e07fc1f90ae7");
    expect(deps.service?.mappedRoom("!room:localhost")).toBe("7c9e6679-7425-40de-944b-e07fc1f90ae7");
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
    const response = await request(app(true)).post(SFU_ROUTE).send(body);

    // Assert
    expect(response.status).toBe(403);
    expect(response.body.code).toBe(FORBIDDEN);
  });

  it("should answer 401 when the OpenID token is rejected", async () => {
    // Arrange
    mockFetch(json(401, {}));

    // Act
    const response = await request(app(true)).post(SFU_ROUTE).send(body);

    // Assert
    expect(response.status).toBe(401);
    expect(response.body.code).toBe(UNAUTHORIZED);
  });

  it("should answer 403 for a token of another homeserver", async () => {
    // Act
    const response = await request(app(true))
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

  function app(withMeet: boolean): express.Express {
    return setupApp(makeDeps(withMeet));
  }
});
