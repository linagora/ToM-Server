import { describe, expect, it } from "bun:test";

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

describe("bots backend", () => {
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

  it("refuses to start a ToM configured for the harness rather than fall back to Hermes", () => {
    expect(() =>
      makeBotsBackend(
        {
          ...common,
          backend: "harness",
          harness: {
            url: "https://gateway.example.com/agents",
            token_url: "https://auth.example.com/oauth2/token",
            client_id: "tom",
            client_secret: "s3cret",
          },
        },
        synapse,
        silentLogger,
      ),
    ).toThrow("bots.backend harness is not available in this version of ToM");
  });
});
