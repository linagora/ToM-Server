import { afterEach, describe, expect, it } from "bun:test";

import { createLogger } from "winston";

import { makeBotsBackend } from "./backend";
import type { BotsSettings, SynapseAccess } from "./types";

const silentLogger = createLogger({
  silent: true,
});

const synapse: SynapseAccess = {
  serverUrl: "https://matrix.example.com",
  serverName: "example.com",
  admin: {
    login: "",
    password: "",
    accessToken: "syt_admin",
  },
};

const common: Omit<BotsSettings, "backend"> = {
  enabled: true,
  hermes_home: "/opt/data",
  model: {
    provider: "openrouter",
    name: "model",
  },
  bot_localpart_prefix: "bot_",
  device_id_prefix: "HERMES",
  commands: [],
  timeout_ms: 1000,
  ready_timeout_ms: 0,
  publish_interval_ms: 60000,
};

let server: ReturnType<typeof Bun.serve> | null = null;

describe("bots backend", () => {
  afterEach(() => {
    server?.stop(true);
    server = null;
  });

  it("keeps Hermes and its announcer of commands as the default backend", () => {
    const backend = makeBotsBackend(
      {
        ...common,
        backend: "hermes",
        hermes_profiles_dir: "/tmp/profiles",
      },
      synapse,
      silentLogger,
    );

    expect(backend.commands).not.toBeNull();
  });

  it("asks the harness for the bots, and announces no command itself, when the harness serves them", async () => {
    const paths: string[] = [];
    server = Bun.serve({
      port: 0,
      fetch(req: Request): Response {
        const path = new URL(req.url).pathname;
        paths.push(path);
        return Response.json(
          path === "/oauth2/token"
            ? {
                access_token: "tok",
                expires_in: 300,
              }
            : {
                userId: "@bot_dwho:example.com",
                deviceId: "DEVICE",
                masterKey: "mk",
              },
        );
      },
    });

    const backend = makeBotsBackend(
      {
        ...common,
        backend: "harness",
        harness: {
          url: `http://127.0.0.1:${server.port}`,
          token_url: `http://127.0.0.1:${server.port}/oauth2/token`,
          client_id: "tom",
          client_secret: "s3cret",
          scope: "openid",
        },
      },
      synapse,
      silentLogger,
    );
    const bot = await backend.service.provision("@dwho:example.com", "syt_owner");

    expect(bot.userId).toBe("@bot_dwho:example.com");
    expect(paths).toEqual([
      "/oauth2/token",
      "/v1/provisioning/assistants/%40dwho%3Aexample.com",
    ]);
    expect(backend.commands).toBeNull();
  });

  it("never falls back to Hermes on a ToM the harness serves", () => {
    expect(() =>
      makeBotsBackend(
        {
          ...common,
          backend: "harness",
        },
        synapse,
        silentLogger,
      ),
    ).toThrow("bots.harness is required when bots.backend is harness");
  });
});
