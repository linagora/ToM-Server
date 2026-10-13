import { afterEach, beforeAll, describe, expect, it, type Mock, mock } from "bun:test";

import { createLogger } from "winston";

import { loadMessages } from "../../i18n/index";
import { VisioUpstreamError } from "./errors";
import { SynapseAdmin } from "./synapse-admin";

const silentLogger = createLogger({
  silent: true,
});

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
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

const settings = {
  serverUrl: "https://localhost:8448",
  timeoutMs: 1000,
  admin: {
    login: "tomadmin",
    password: "tomadmin-password",
    accessToken: "",
  },
};

const withProvider = {
  ...settings,
  oidcProvider: "oidc-twake",
};

const loginOk = (): Response =>
  json(200, {
    access_token: "admin-token",
  });

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: test suite
describe("SynapseAdmin", () => {
  const originalFetch = globalThis.fetch;

  beforeAll(() => {
    loadMessages("assets/i18n", silentLogger);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should log in once with the admin credentials, then read the members", async () => {
    // Arrange
    const fetchMock = mockFetch(
      loginOk(),
      json(200, {
        members: [
          "@alice:localhost",
          "@bob:localhost",
        ],
        total: 2,
      }),
      json(200, {
        members: [],
        total: 0,
      }),
    );
    const admin = new SynapseAdmin(settings, silentLogger);

    // Act
    const alice = await admin.isMember("@alice:localhost", "!room:localhost");
    const mallory = await admin.isMember("@mallory:localhost", "!room:localhost");

    // Assert
    expect(alice).toBe(true);
    expect(mallory).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://localhost:8448/_matrix/client/v3/login");
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://localhost:8448/_synapse/admin/v1/rooms/!room%3Alocalhost/members",
    );
    expect((fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string> | undefined)?.Authorization).toBe(
      "Bearer admin-token",
    );
  });

  it("should use the configured access token without logging in", async () => {
    // Arrange
    const fetchMock = mockFetch(
      json(404, {
        errcode: "M_NOT_FOUND",
      }),
    );
    const admin = new SynapseAdmin(
      {
        ...settings,
        admin: {
          ...settings.admin,
          accessToken: "configured-token",
        },
      },
      silentLogger,
    );

    // Act
    const member = await admin.isMember("@alice:localhost", "!unknown:localhost");

    // Assert
    expect(member).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string> | undefined)?.Authorization).toBe(
      "Bearer configured-token",
    );
  });

  it("should tell a moderator from a member by the power levels of the room", async () => {
    // Arrange
    mockFetch(
      loginOk(),
      json(200, {
        state: [
          {
            type: "m.room.create",
            content: {},
          },
          {
            type: "m.room.power_levels",
            content: {
              users: {
                "@alice:localhost": 50,
              },
              users_default: 0,
            },
          },
        ],
      }),
      json(200, {
        state: [
          {
            type: "m.room.power_levels",
            content: {
              users: {
                "@alice:localhost": 50,
              },
              users_default: 0,
            },
          },
        ],
      }),
    );
    const admin = new SynapseAdmin(settings, silentLogger);

    // Act & Assert
    expect(await admin.isModerator("@alice:localhost", "!room:localhost")).toBe(true);
    expect(await admin.isModerator("@bob:localhost", "!room:localhost")).toBe(false);
  });

  it("should make the creators of a room of version 12 moderators, whatever its power levels", async () => {
    // Arrange
    const state = (roomVersion: string): Response =>
      json(200, {
        state: [
          {
            type: "m.room.create",
            sender: "@alice:localhost",
            content: {
              room_version: roomVersion,
              additional_creators: [
                "@carol:localhost",
              ],
            },
          },
          {
            type: "m.room.power_levels",
            content: {
              users_default: 0,
            },
          },
        ],
      });
    mockFetch(loginOk(), state("12"), state("12"), state("12"), state("11"));
    const admin = new SynapseAdmin(settings, silentLogger);

    // Act & Assert
    expect(await admin.isModerator("@alice:localhost", "!room:localhost")).toBe(true);
    expect(await admin.isModerator("@carol:localhost", "!room:localhost")).toBe(true);
    expect(await admin.isModerator("@bob:localhost", "!room:localhost")).toBe(false);
    // Before version 12 the creator is only what the power levels say
    expect(await admin.isModerator("@alice:localhost", "!room:localhost")).toBe(false);
  });

  it("should read the name, the single email and the OIDC subject of a user", async () => {
    // Arrange
    mockFetch(
      loginOk(),
      json(200, {
        name: "@alice:localhost",
        displayname: "Alice",
        threepids: [
          {
            medium: "email",
            address: "alice@twake.test",
          },
          {
            medium: "msisdn",
            address: "33600000000",
          },
        ],
        external_ids: [
          {
            auth_provider: "oidc-twake",
            external_id: "alice-sub",
          },
        ],
      }),
      json(200, {
        name: "@bob:localhost",
        displayname: null,
        threepids: [],
      }),
    );
    const admin = new SynapseAdmin(withProvider, silentLogger);

    // Act & Assert
    expect(await admin.profile("@alice:localhost")).toEqual({
      displayName: "Alice",
      email: "alice@twake.test",
      sub: "alice-sub",
    });
    expect(await admin.profile("@bob:localhost")).toEqual({
      displayName: null,
      email: null,
      sub: null,
    });
  });

  it("should send the subject of the configured provider only, and none without one", async () => {
    // Arrange
    const user = (): Response =>
      json(200, {
        displayname: "Alice",
        external_ids: [
          {
            auth_provider: "saml",
            external_id: "saml-sub",
          },
          {
            auth_provider: "oidc-twake",
            external_id: "oidc-sub",
          },
        ],
      });
    mockFetch(
      user(),
      json(200, {
        external_ids: [
          {
            auth_provider: "saml",
            external_id: "saml-sub",
          },
        ],
      }),
      user(),
    );
    const withToken = (config: typeof settings): SynapseAdmin =>
      new SynapseAdmin(
        {
          ...config,
          admin: {
            ...config.admin,
            accessToken: "configured-token",
          },
        },
        silentLogger,
      );

    // Act
    const chosen = await withToken(withProvider).profile("@alice:localhost");
    const otherOnly = await withToken(withProvider).profile("@alice:localhost");
    const unconfigured = await withToken(settings).profile("@alice:localhost");

    // Assert
    expect(chosen.sub).toBe("oidc-sub");
    expect(otherOnly.sub).toBeNull();
    expect(unconfigured.sub).toBeNull();
  });

  it("should answer BAD_GATEWAY when the homeserver fails", async () => {
    // Arrange
    mockFetch(loginOk(), json(500, {}));
    const admin = new SynapseAdmin(settings, silentLogger);

    // Act & Assert
    await expect(admin.profile("@alice:localhost")).rejects.toBeInstanceOf(VisioUpstreamError);
  });
});
