import { afterEach, beforeAll, describe, expect, it, type Mock, mock } from "bun:test";

import { createLogger } from "winston";

import { BAD_GATEWAY, FORBIDDEN, UNAUTHORIZED } from "../../errors/error-codes";
import { loadMessages } from "../../i18n/index";
import { VisioForbiddenError, VisioOpenIdError, VisioUpstreamError } from "./errors";
import { OpenIdValidator } from "./openid";

const silentLogger = createLogger({
  silent: true,
});

const openIdToken = {
  access_token: "openid-token",
  token_type: "Bearer",
  matrix_server_name: "localhost",
  expires_in: 3600,
};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
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

describe("OpenIdValidator", () => {
  const originalFetch = globalThis.fetch;
  const validator = new OpenIdValidator(
    {
      serverUrl: "https://localhost:8448",
      serverName: "localhost",
      timeoutMs: 1000,
    },
    silentLogger,
  );

  beforeAll(() => {
    loadMessages("assets/i18n", silentLogger);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should ask the homeserver who the token stands for", async () => {
    // Arrange
    const fetchMock = mockFetch(
      json(200, {
        sub: "@alice:localhost",
      }),
    );

    // Act
    const userId = await validator.resolve(openIdToken);

    // Assert
    expect(userId).toBe("@alice:localhost");
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://localhost:8448/_matrix/federation/v1/openid/userinfo?access_token=openid-token",
    );
  });

  it("should refuse a token of another homeserver without asking anyone", async () => {
    // Arrange
    const fetchMock = mockFetch();

    // Act
    const error = await validator
      .resolve({
        ...openIdToken,
        matrix_server_name: "elsewhere.org",
      })
      .catch((err: unknown) => err);

    // Assert
    expect(error).toBeInstanceOf(VisioForbiddenError);
    expect((error as VisioForbiddenError).code).toBe(FORBIDDEN);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("should answer UNAUTHORIZED when the homeserver rejects the token", async () => {
    // Arrange
    mockFetch(
      json(401, {
        errcode: "M_UNKNOWN_TOKEN",
      }),
    );

    // Act
    const error = await validator.resolve(openIdToken).catch((err: unknown) => err);

    // Assert
    expect(error).toBeInstanceOf(VisioOpenIdError);
    expect((error as VisioOpenIdError).code).toBe(UNAUTHORIZED);
  });

  it("should refuse a user the homeserver says is from elsewhere", async () => {
    // Arrange
    mockFetch(
      json(200, {
        sub: "@mallory:elsewhere.org",
      }),
    );

    // Act & Assert
    await expect(validator.resolve(openIdToken)).rejects.toBeInstanceOf(VisioForbiddenError);
  });

  it.each([
    json(500, {}),
    new TypeError("fetch failed"),
    json(200, {
      sub: "not a user id",
    }),
  ])("should answer BAD_GATEWAY when the homeserver fails (%p)", async (result) => {
    // Arrange
    mockFetch(result);

    // Act
    const error = await validator.resolve(openIdToken).catch((err: unknown) => err);

    // Assert
    expect(error).toBeInstanceOf(VisioUpstreamError);
    expect((error as VisioUpstreamError).code).toBe(BAD_GATEWAY);
  });
});
