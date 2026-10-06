import { afterEach, beforeAll, describe, expect, it, type Mock, mock } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLogger } from "winston";

import { BAD_GATEWAY, NOT_FOUND, SERVICE_UNAVAILABLE } from "../../errors/error-codes";
import { loadMessages } from "../../i18n/index";
import { BotsService, botIds } from "./service";
import type { BotsSettings, SynapseAccess } from "./types";

const silentLogger = createLogger({
  silent: true,
});

const OWNER = "@dwho:example.com";
const OWNER_TOKEN = "syt_owner";
const BOT = "@bot_dwho:example.com";
const DEVICE = "HERMESDWHO";
const MASTER_KEY = "mk+base64";

const synapse: SynapseAccess = {
  serverUrl: "https://matrix.example.com",
  serverName: "example.com",
  admin: {
    login: "",
    password: "",
    accessToken: "syt_admin",
  },
};

let profilesDir = "";

const settings = (overrides: Partial<BotsSettings> = {}): BotsSettings => ({
  enabled: true,
  hermes_profiles_dir: profilesDir,
  hermes_home: "/opt/data",
  model: {
    provider: "openrouter",
    name: "anthropic/claude-haiku-4.5",
    api_key: "sk-or-test",
  },
  bot_localpart_prefix: "bot_",
  device_id_prefix: "HERMES",
  commands: [],
  timeout_ms: 1000,
  ready_timeout_ms: 0,
  publish_interval_ms: 60000,
  ...overrides,
});

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });

const keysPublished = (): Response =>
  json(200, {
    master_keys: {
      [BOT]: {
        keys: {
          "ed25519:abc": MASTER_KEY,
        },
      },
    },
    device_keys: {
      [BOT]: {
        [DEVICE]: {},
      },
    },
  });

const keysMissing = (): Response => json(200, {});

const mockFetch = (...responses: Response[]): Mock<typeof fetch> => {
  const fetchMock: Mock<typeof fetch> = mock();
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response);
  }
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
};

const originalFetch = globalThis.fetch;

describe("BotsService", () => {
  beforeAll(() => {
    loadMessages(undefined, silentLogger);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (profilesDir && existsSync(profilesDir)) {
      rmSync(profilesDir, {
        recursive: true,
      });
    }
    profilesDir = mkdtempSync(join(tmpdir(), "tom-bots-"));
  });

  it("sets the direct room as the home channel of the bot, once, whatever was there", () => {
    profilesDir = mkdtempSync(join(tmpdir(), "tom-bots-"));
    const dir = join(profilesDir, "bot_dwho");
    mkdirSync(dir, {
      recursive: true,
    });
    writeFileSync(join(dir, ".env"), `MATRIX_USER_ID=${BOT}\nMATRIX_HOME_CHANNEL=${OWNER}\n`);
    const service = new BotsService(settings(), synapse, silentLogger);

    service.setHome(OWNER, "!dm:example.com");
    service.setHome(OWNER, "!dm:example.com");

    const env = readFileSync(join(dir, ".env"), "utf8");
    expect(env).toBe(`MATRIX_USER_ID=${BOT}\nMATRIX_HOME_CHANNEL=!dm:example.com\n`);
    expect(statSync(join(dir, ".env")).mode & 0o777).toBe(0o600);
  });

  it("refuses a home channel for a user without an assistant", () => {
    profilesDir = mkdtempSync(join(tmpdir(), "tom-bots-"));
    const service = new BotsService(settings(), synapse, silentLogger);

    expect(() => service.setHome(OWNER, "!dm:example.com")).toThrow(
      expect.objectContaining({
        code: NOT_FOUND,
      }),
    );
  });

  it("names the bot and its device after the owner", () => {
    expect(botIds("@jean-luc.picard:example.com", settings(), "example.com")).toEqual({
      localpart: "bot_jean-luc.picard",
      userId: "@bot_jean-luc.picard:example.com",
      deviceId: "HERMESJEANLUCPICARD",
    });
  });

  it("creates the account, logs the bot in, writes its profile and answers its keys", async () => {
    profilesDir = mkdtempSync(join(tmpdir(), "tom-bots-"));
    const fetchMock = mockFetch(
      json(201, {}),
      json(200, {
        access_token: "syt_bot",
        device_id: DEVICE,
      }),
      keysPublished(),
    );
    const service = new BotsService(settings(), synapse, silentLogger);

    const bot = await service.provision(OWNER, OWNER_TOKEN);

    expect(bot).toEqual({
      userId: BOT,
      deviceId: DEVICE,
      masterKey: MASTER_KEY,
    });
    const [createUrl, createInit] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(createUrl).toBe("https://matrix.example.com/_synapse/admin/v2/users/%40bot_dwho%3Aexample.com");
    expect(createInit.method).toBe("PUT");
    expect(JSON.parse(String(createInit.body))).toMatchObject({
      admin: false,
      user_type: "bot",
    });
    const [, loginInit] = fetchMock.mock.calls[1] as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(loginInit.body))).toMatchObject({
      type: "m.login.password",
      identifier: {
        user: "bot_dwho",
      },
      device_id: DEVICE,
    });
    const env = readFileSync(join(profilesDir, "bot_dwho", ".env"), "utf8");
    expect(env).toContain("MATRIX_ACCESS_TOKEN=syt_bot");
    expect(env).toMatch(/^MATRIX_HOME_CHANNEL=@/m);
    expect(env).toContain(`MATRIX_USER_ID=${BOT}`);
    expect(env).toContain(`MATRIX_DEVICE_ID=${DEVICE}`);
    expect(env).toContain(`MATRIX_ALLOWED_USERS=${OWNER}`);
    expect(env).toContain("OPENROUTER_API_KEY=sk-or-test");
    expect(env).toContain("MATRIX_RECOVERY_KEY_OUTPUT_FILE=/opt/data/profiles/bot_dwho/recovery-key");
    expect(statSync(join(profilesDir, "bot_dwho", ".env")).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(profilesDir, "bot_dwho", "config.yaml"), "utf8")).toContain(
      "default: anthropic/claude-haiku-4.5",
    );
  });

  it("answers the same bot again without touching the homeserver, once the profile is there", async () => {
    profilesDir = mkdtempSync(join(tmpdir(), "tom-bots-"));
    mockFetch(
      json(201, {}),
      json(200, {
        access_token: "syt_bot",
      }),
      keysPublished(),
    );
    const service = new BotsService(settings(), synapse, silentLogger);
    await service.provision(OWNER, OWNER_TOKEN);

    const fetchMock = mockFetch(keysPublished());
    const again = await service.provision(OWNER, OWNER_TOKEN);

    expect(again.masterKey).toBe(MASTER_KEY);
    expect(fetchMock.mock.calls).toHaveLength(1);
  });

  it("says the bot is not ready while Hermes has not published its keys", async () => {
    profilesDir = mkdtempSync(join(tmpdir(), "tom-bots-"));
    mockFetch(
      json(201, {}),
      json(200, {
        access_token: "syt_bot",
      }),
      keysMissing(),
    );
    const service = new BotsService(settings(), synapse, silentLogger);

    await expect(service.provision(OWNER, OWNER_TOKEN)).rejects.toMatchObject({
      code: SERVICE_UNAVAILABLE,
    });
    // The profile stays: the next call only waits for the keys
    expect(existsSync(join(profilesDir, "bot_dwho", ".env"))).toBe(true);
  });

  it("reports a homeserver that refuses the account, and writes no profile", async () => {
    profilesDir = mkdtempSync(join(tmpdir(), "tom-bots-"));
    mockFetch(
      json(403, {
        errcode: "M_FORBIDDEN",
      }),
    );
    const service = new BotsService(settings(), synapse, silentLogger);

    await expect(service.provision(OWNER, OWNER_TOKEN)).rejects.toMatchObject({
      code: BAD_GATEWAY,
    });
    expect(existsSync(join(profilesDir, "bot_dwho"))).toBe(false);
  });

  it("logs the admin in with its password when no admin token is configured", async () => {
    profilesDir = mkdtempSync(join(tmpdir(), "tom-bots-"));
    const fetchMock = mockFetch(
      json(200, {
        access_token: "syt_admin_login",
      }),
      json(201, {}),
      json(200, {
        access_token: "syt_bot",
      }),
      keysPublished(),
    );
    const service = new BotsService(
      settings(),
      {
        ...synapse,
        admin: {
          login: "tomadmin",
          password: "secret",
          accessToken: "",
        },
      },
      silentLogger,
    );

    await service.provision(OWNER, OWNER_TOKEN);

    const [, adminLogin] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(adminLogin.body))).toMatchObject({
      identifier: {
        user: "tomadmin",
      },
      password: "secret",
    });
    const [, createInit] = fetchMock.mock.calls[1] as [
      string,
      RequestInit,
    ];
    expect(new Headers(createInit.headers).get("Authorization")).toBe("Bearer syt_admin_login");
  });
});
