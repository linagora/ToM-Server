import { afterEach, describe, expect, it, mock } from "bun:test";

import { createLogger } from "winston";

import { EmailResolver } from "./email-resolver";
import { VisioUpstreamError } from "./errors";

const silentLogger = createLogger({
  silent: true,
});

const resolver = new EmailResolver(
  {
    serverUrl: "https://matrix.example.com",
    timeoutMs: 1000,
  },
  silentLogger,
);

const mockFetch = (result: Response | Error): void => {
  globalThis.fetch = mock(() =>
    result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
  ) as unknown as typeof fetch;
};

const threepids = (
  ...entries: Array<{
    medium: string;
    address: string;
  }>
): Response =>
  new Response(
    JSON.stringify({
      threepids: entries,
    }),
  );

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: test suite
describe("EmailResolver", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should return the email among the user's third-party identifiers", async () => {
    // Arrange
    mockFetch(
      threepids(
        {
          medium: "msisdn",
          address: "33600000000",
        },
        {
          medium: "email",
          address: "dwho@example.com",
        },
      ),
    );

    // Act
    const email = await resolver.resolve("t0ken");

    // Assert
    expect(email).toBe("dwho@example.com");
  });

  it("should return null when the user has no email", async () => {
    // Arrange
    mockFetch(
      threepids({
        medium: "msisdn",
        address: "33600000000",
      }),
    );

    // Act
    const email = await resolver.resolve("t0ken");

    // Assert
    expect(email).toBeNull();
  });

  it("should return null when the user has several emails", async () => {
    // Arrange
    mockFetch(
      threepids(
        {
          medium: "email",
          address: "dwho@example.com",
        },
        {
          medium: "email",
          address: "doctor@example.org",
        },
      ),
    );

    // Act
    const email = await resolver.resolve("t0ken");

    // Assert
    expect(email).toBeNull();
  });

  it.each([
    401,
    403,
  ])("should throw a VisioUpstreamError when the homeserver rejects the token (%p)", async (status) => {
    // Arrange
    mockFetch(
      new Response("{}", {
        status,
      }),
    );

    // Act
    const error = await resolver.resolve("t0ken").catch((err: unknown) => err);

    // Assert
    expect(error).toBeInstanceOf(VisioUpstreamError);
  });

  it("should throw a VisioUpstreamError when the homeserver fails", async () => {
    // Arrange
    mockFetch(
      new Response("{}", {
        status: 500,
      }),
    );

    // Act
    const error = await resolver.resolve("t0ken").catch((err: unknown) => err);

    // Assert
    expect(error).toBeInstanceOf(VisioUpstreamError);
  });

  it("should throw a VisioUpstreamError when the homeserver is unreachable", async () => {
    // Arrange
    mockFetch(new TypeError("fetch failed"));

    // Act
    const error = await resolver.resolve("t0ken").catch((err: unknown) => err);

    // Assert
    expect(error).toBeInstanceOf(VisioUpstreamError);
  });
});
