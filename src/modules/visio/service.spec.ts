import { afterEach, describe, expect, it, type Mock, mock } from "bun:test";
import { Writable } from "node:stream";

import { createLogger, transports } from "winston";

import { BAD_GATEWAY, NOT_FOUND } from "../../errors/error-codes";
import { VisioRoomUnavailableError, VisioUpstreamError } from "./errors";
import { VisioService } from "./service";
import type { VisioSettings } from "./types";

const silentLogger = createLogger({
  silent: true,
});

const config: VisioSettings = {
  enabled: true,
  base_url: "https://visio.example.com",
  client_id: "tom",
  client_secret: "s3cret",
  timeout_ms: 1000,
};

const TOKEN_URL = "https://visio.example.com/external-api/v1.0/application/token/";
const ROOMS_URL = "https://visio.example.com/external-api/v1.0/rooms/";
const ROOM_URL = "https://visio.example.com/abc-defg-hij";

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });

const tokenOk = (): Response =>
  json(200, {
    access_token: "visio-jwt",
    token_type: "Bearer",
    expires_in: 3600,
    scope: "rooms:create",
  });

const roomOk = (): Response =>
  json(201, {
    id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    slug: "abc-defg-hij",
    access_level: "trusted",
    url: ROOM_URL,
  });

type FetchMock = Mock<(url: string, init: RequestInit) => Promise<Response>>;

const mockFetch = (...results: Array<Response | Error>): FetchMock => {
  const fetchMock: FetchMock = mock();
  for (const result of results) {
    if (result instanceof Error) {
      fetchMock.mockRejectedValueOnce(result);
    } else {
      fetchMock.mockResolvedValueOnce(result);
    }
  }
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  return fetchMock;
};

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: test suite
describe("VisioService", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should request a token for the email then create the room", async () => {
    // Arrange
    const fetchMock = mockFetch(tokenOk(), roomOk());
    const service = new VisioService(config, silentLogger);

    // Act
    const room = await service.createRoom("dwho@example.com");

    // Assert
    expect(room).toEqual({
      url: ROOM_URL,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0] ?? [];
    expect(tokenUrl).toBe(TOKEN_URL);
    expect(tokenInit?.method).toBe("POST");
    expect(tokenInit?.headers).toEqual({
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(tokenInit?.body))).toEqual({
      client_id: "tom",
      client_secret: "s3cret",
      grant_type: "client_credentials",
      scope: "dwho@example.com",
    });
    expect(tokenInit?.signal).toBeInstanceOf(AbortSignal);

    const [roomsUrl, roomsInit] = fetchMock.mock.calls[1] ?? [];
    expect(roomsUrl).toBe(ROOMS_URL);
    expect(roomsInit?.method).toBe("POST");
    expect(roomsInit?.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer visio-jwt",
    });
    expect(JSON.parse(String(roomsInit?.body))).toEqual({});
    expect(roomsInit?.signal).toBeInstanceOf(AbortSignal);
  });

  it("should send access_level when room_access_level is configured", async () => {
    // Arrange
    const fetchMock = mockFetch(tokenOk(), roomOk());
    const service = new VisioService(
      {
        ...config,
        room_access_level: "public",
      },
      silentLogger,
    );

    // Act
    await service.createRoom("dwho@example.com");

    // Assert
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1].body))).toEqual({
      access_level: "public",
    });
  });

  it("should handle a base_url with a trailing slash", async () => {
    // Arrange
    const fetchMock = mockFetch(tokenOk(), roomOk());
    const service = new VisioService(
      {
        ...config,
        base_url: "https://visio.example.com/",
      },
      silentLogger,
    );

    // Act
    await service.createRoom("dwho@example.com");

    // Assert
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      TOKEN_URL,
      ROOMS_URL,
    ]);
  });

  it("should throw NOT_FOUND when the token endpoint answers 404", async () => {
    // Arrange
    const fetchMock = mockFetch(
      json(404, {
        detail: "User not found.",
      }),
    );
    const service = new VisioService(config, silentLogger);

    // Act
    const error = await service.createRoom("dwho@example.com").catch((err: unknown) => err);

    // Assert
    expect(error).toBeInstanceOf(VisioRoomUnavailableError);
    expect((error as VisioRoomUnavailableError).code).toBe(NOT_FOUND);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    401,
    403,
    500,
  ])("should throw BAD_GATEWAY when the token endpoint answers %d", async (status) => {
    // Arrange
    const fetchMock = mockFetch(
      json(status, {
        detail: "Invalid credentials",
      }),
    );
    const service = new VisioService(config, silentLogger);

    // Act
    const error = await service.createRoom("dwho@example.com").catch((err: unknown) => err);

    // Assert
    expect(error).toBeInstanceOf(VisioUpstreamError);
    expect((error as VisioUpstreamError).code).toBe(BAD_GATEWAY);
    expect((error as VisioUpstreamError).message).toContain(`status ${status}`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("should throw BAD_GATEWAY when the token response has no access_token", async () => {
    // Arrange
    mockFetch(
      json(200, {
        token_type: "Bearer",
      }),
    );
    const service = new VisioService(config, silentLogger);

    // Act & Assert
    await expect(service.createRoom("dwho@example.com")).rejects.toBeInstanceOf(VisioUpstreamError);
  });

  it.each([
    403,
    404,
  ])("should throw BAD_GATEWAY when the rooms endpoint answers %d", async (status) => {
    // Arrange
    mockFetch(
      tokenOk(),
      json(status, {
        detail: "Insufficient permissions. Required scope: rooms:create",
      }),
    );
    const service = new VisioService(config, silentLogger);

    // Act & Assert
    await expect(service.createRoom("dwho@example.com")).rejects.toBeInstanceOf(VisioUpstreamError);
  });

  it("should throw BAD_GATEWAY when the room has no url", async () => {
    // Arrange
    mockFetch(
      tokenOk(),
      json(201, {
        slug: "abc-defg-hij",
      }),
    );
    const service = new VisioService(config, silentLogger);

    // Act & Assert
    await expect(service.createRoom("dwho@example.com")).rejects.toBeInstanceOf(VisioUpstreamError);
  });

  it("should throw BAD_GATEWAY when the body is not JSON", async () => {
    // Arrange
    mockFetch(
      new Response("<html>ok</html>", {
        status: 200,
      }),
    );
    const service = new VisioService(config, silentLogger);

    // Act & Assert
    await expect(service.createRoom("dwho@example.com")).rejects.toBeInstanceOf(VisioUpstreamError);
  });

  it("should throw BAD_GATEWAY when fetch rejects", async () => {
    // Arrange
    mockFetch(new TypeError("fetch failed"));
    const service = new VisioService(config, silentLogger);

    // Act & Assert
    await expect(service.createRoom("dwho@example.com")).rejects.toBeInstanceOf(VisioUpstreamError);
  });

  it("should throw BAD_GATEWAY when the service does not answer within timeout_ms", async () => {
    // Arrange
    globalThis.fetch = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as unknown as typeof fetch;
    const service = new VisioService(
      {
        ...config,
        timeout_ms: 10,
      },
      silentLogger,
    );

    // Act
    const error = await service.createRoom("dwho@example.com").catch((err: unknown) => err);

    // Assert
    expect(error).toBeInstanceOf(VisioUpstreamError);
    expect((error as VisioUpstreamError).message).toContain("TimeoutError");
  });

  it("should never log nor report the secret, the token or the email", async () => {
    // Arrange
    const lines: string[] = [];
    const logger = createLogger({
      level: "silly",
      transports: [
        new transports.Stream({
          stream: new Writable({
            write(chunk: Buffer, _encoding: BufferEncoding, done: () => void): void {
              lines.push(String(chunk));
              done();
            },
          }),
        }),
      ],
    });
    mockFetch(
      tokenOk(),
      roomOk(),
      tokenOk(),
      json(403, {
        detail: "nope",
      }),
    );
    const service = new VisioService(config, logger);

    // Act
    await service.createRoom("dwho@example.com");
    const error = (await service.createRoom("dwho@example.com").catch((err: unknown) => err)) as VisioUpstreamError;

    // Assert
    const dump = `${lines.join("")} ${error.message} ${JSON.stringify(error.context)}`;
    expect(dump).toContain("status 403");
    expect(dump).not.toContain("s3cret");
    expect(dump).not.toContain("visio-jwt");
    expect(dump).not.toContain("dwho@example.com");
  });
});
