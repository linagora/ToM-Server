import { afterEach, describe, expect, it, type Mock, mock } from "bun:test";

import { Router } from "express";
import request from "supertest";
import { createLogger } from "winston";

import { createApp } from "./app";
import { configSchema } from "./config/schema";

const ROUTE = "/_twake/v1/video_call/rooms";
const ROOM_URL = "https://visio.example.com/abc-defg-hij";
const TOKEN = "syt_matrix_token";

mock.module("./modules/legacy/router", () => ({
  createLegacyRouter: () => Promise.resolve(Router()),
}));

const config = configSchema.parse({
  server: {
    name: "example.com",
  },
  synapse: {
    server_url: "https://matrix.example.com/",
  },
  database: {
    host: "localhost",
    name: "tom",
    user: "tom",
    password: "tom",
  },
  visio: {
    enabled: true,
    base_url: "https://visio.example.com",
    client_id: "tom",
    client_secret: "s3cret",
  },
});

const silentLogger = createLogger({
  silent: true,
});

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
  });

type FetchMock = Mock<(url: string, init: RequestInit) => Promise<Response>>;

interface Homeserver {
  userId?: string;
  email?: string;
}

// Routes the fetch calls of the whole chain: whoami, 3pid, visio token, visio room
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one branch per endpoint
const mockFetch = ({ userId, email }: Homeserver): FetchMock => {
  const fetchMock: FetchMock = mock((url: string) => {
    if (url.endsWith("/account/whoami")) {
      return Promise.resolve(
        userId
          ? json(200, {
              user_id: userId,
            })
          : json(401, {
              errcode: "M_UNKNOWN_TOKEN",
            }),
      );
    }
    if (url.endsWith("/account/3pid")) {
      return Promise.resolve(
        json(200, {
          threepids: email
            ? [
                {
                  medium: "email",
                  address: email,
                },
              ]
            : [],
        }),
      );
    }
    if (url.endsWith("/application/token/")) {
      return Promise.resolve(
        json(200, {
          access_token: "visio-jwt",
        }),
      );
    }

    return Promise.resolve(
      json(201, {
        url: ROOM_URL,
      }),
    );
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  return fetchMock;
};

const calledUrls = (fetchMock: FetchMock): string[] => fetchMock.mock.calls.map((call) => call[0]);

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: test suite
describe("createApp video call rooms", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should create the room with the homeserver email of the authenticated user", async () => {
    // Arrange
    const fetchMock = mockFetch({
      userId: "@dwho:example.com",
      email: "dwho@example.com",
    });
    const app = await createApp(config, silentLogger, undefined);

    // Act
    const response = await request(app).post(ROUTE).set("Authorization", `Bearer ${TOKEN}`).send({});

    // Assert
    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      url: ROOM_URL,
    });
    expect(calledUrls(fetchMock)[0]).toBe("https://matrix.example.com/_matrix/client/v3/account/whoami");
    expect(fetchMock.mock.calls[0]?.[1].headers).toEqual({
      Authorization: `Bearer ${TOKEN}`,
    });
    const tokenCall = fetchMock.mock.calls.find((call) => call[0].endsWith("/application/token/"));
    expect(JSON.parse(String(tokenCall?.[1].body)).scope).toBe("dwho@example.com");
  });

  it("should answer 401 without a bearer token", async () => {
    // Arrange
    const fetchMock = mockFetch({});
    const app = await createApp(config, silentLogger, undefined);

    // Act
    const response = await request(app).post(ROUTE).send({});

    // Assert
    expect(response.status).toBe(401);
    expect(response.body.errcode).toBe("M_UNAUTHORIZED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("should answer 401 when the homeserver rejects the token", async () => {
    // Arrange
    const fetchMock = mockFetch({});
    const app = await createApp(config, silentLogger, undefined);

    // Act
    const response = await request(app).post(ROUTE).set("Authorization", "Bearer bad").send({});

    // Assert
    expect(response.status).toBe(401);
    expect(calledUrls(fetchMock)).toHaveLength(1);
  });

  it("should answer 502 M_BAD_GATEWAY when the homeserver is unreachable", async () => {
    // Arrange
    globalThis.fetch = mock(() => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch;
    const app = await createApp(config, silentLogger, undefined);

    // Act
    const response = await request(app).post(ROUTE).set("Authorization", `Bearer ${TOKEN}`).send({});

    // Assert
    expect(response.status).toBe(502);
    expect(response.body.errcode).toBe("M_BAD_GATEWAY");
  });

  it("should answer 502 M_BAD_GATEWAY when the homeserver fails", async () => {
    // Arrange
    globalThis.fetch = mock(() => Promise.resolve(json(500, {}))) as unknown as typeof fetch;
    const app = await createApp(config, silentLogger, undefined);

    // Act
    const response = await request(app).post(ROUTE).set("Authorization", `Bearer ${TOKEN}`).send({});

    // Assert
    expect(response.status).toBe(502);
    expect(response.body.errcode).toBe("M_BAD_GATEWAY");
  });

  it("should answer 401 for a user of another homeserver", async () => {
    // Arrange
    const fetchMock = mockFetch({
      userId: "@dwho:other.example",
      email: "dwho@example.com",
    });
    const app = await createApp(config, silentLogger, undefined);

    // Act
    const response = await request(app).post(ROUTE).set("Authorization", `Bearer ${TOKEN}`).send({});

    // Assert
    expect(response.status).toBe(401);
    expect(calledUrls(fetchMock)).toHaveLength(1);
  });

  it("should answer 404 M_NOT_FOUND when the user has no email", async () => {
    // Arrange
    const fetchMock = mockFetch({
      userId: "@dwho:example.com",
    });
    const app = await createApp(config, silentLogger, undefined);

    // Act
    const response = await request(app).post(ROUTE).set("Authorization", `Bearer ${TOKEN}`).send({});

    // Assert
    expect(response.status).toBe(404);
    expect(response.body.errcode).toBe("M_NOT_FOUND");
    expect(calledUrls(fetchMock).some((url) => url.includes("visio.example.com"))).toBe(false);
  });

  it("should answer 404 M_NOT_FOUND when the module is disabled", async () => {
    // Arrange
    const fetchMock = mockFetch({});
    const disabled = configSchema.parse({
      ...config,
      visio: {
        enabled: false,
      },
    });
    const app = await createApp(disabled, silentLogger, undefined);

    // Act
    const response = await request(app).post(ROUTE).send({});

    // Assert
    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
