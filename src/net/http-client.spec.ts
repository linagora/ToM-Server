import { afterEach, describe, expect, it, type Mock, mock } from "bun:test";

import { z } from "zod";

import { HttpClient, readJson, UnreachableError } from "./http-client";

type FetchMock = Mock<(url: string, init: RequestInit) => Promise<Response>>;

const mockFetch = (result: Response | Error): FetchMock => {
  const fetchMock: FetchMock = mock(() => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)));
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  return fetchMock;
};

const client = new HttpClient({
  baseUrl: "https://remote.example.com/",
  timeoutMs: 1000,
});

describe("HttpClient", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should GET the path on the base URL with the bearer token", async () => {
    // Arrange
    const fetchMock = mockFetch(new Response("{}"));

    // Act
    await client.get("/path", "t0ken");

    // Assert
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://remote.example.com/path");
    expect(init?.method).toBe("GET");
    expect(init?.headers).toEqual({
      Authorization: "Bearer t0ken",
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("should POST a JSON body without authorization when no token is given", async () => {
    // Arrange
    const fetchMock = mockFetch(new Response("{}"));

    // Act
    await client.post("/path", {
      key: "value",
    });

    // Assert
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      key: "value",
    });
  });

  it("should return error statuses as responses", async () => {
    // Arrange
    mockFetch(
      new Response("{}", {
        status: 500,
      }),
    );

    // Act
    const response = await client.get("/path");

    // Assert
    expect(response.status).toBe(500);
  });

  it("should throw an UnreachableError when the request fails", async () => {
    // Arrange
    mockFetch(new TypeError("fetch failed"));

    // Act
    const error = await client.get("/path").catch((err: unknown) => err);

    // Assert
    expect(error).toBeInstanceOf(UnreachableError);
    expect((error as UnreachableError).message).toBe("TypeError: fetch failed");
  });
});

describe("readJson", () => {
  const schema = z.object({
    id: z.string(),
  });

  it("should return the body matching the schema", async () => {
    // Act
    const body = await readJson(new Response('{"id":"a"}'), schema);

    // Assert
    expect(body).toEqual({
      id: "a",
    });
  });

  it("should return undefined for a body not matching the schema", async () => {
    // Act
    const body = await readJson(new Response('{"other":1}'), schema);

    // Assert
    expect(body).toBeUndefined();
  });

  it("should return undefined for a body that is not JSON", async () => {
    // Act
    const body = await readJson(new Response("<html>"), schema);

    // Assert
    expect(body).toBeUndefined();
  });
});
