import { afterEach, beforeAll, describe, expect, it, type Mock, mock } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLogger } from "winston";

import { loadMessages } from "../../i18n/index";
import { BotCommandsPublisher, COMMANDS_EVENT_TYPE, readProfiles } from "./commands";
import type { BotsSettings } from "./types";

const silentLogger = createLogger({
  silent: true,
});

const BOT = "@bot_dwho:example.com";
const ROOM = "!room:example.com";

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
  });

const originalFetch = globalThis.fetch;
let dir = "";

describe("bot commands publisher", () => {
  beforeAll(() => {
    loadMessages(undefined, silentLogger);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    rmSync(dir, {
      recursive: true,
      force: true,
    });
  });

  it("writes the commands of each bot in every room it is in, once", async () => {
    dir = mkdtempSync(join(tmpdir(), "tom-bots-"));
    mkdirSync(join(dir, "bot_dwho"));
    writeFileSync(join(dir, "bot_dwho", ".env"), `MATRIX_USER_ID=${BOT}\nMATRIX_ACCESS_TOKEN=syt_bot\n`);
    mkdirSync(join(dir, "not-a-profile"));
    expect(readProfiles(dir)).toEqual([
      {
        userId: BOT,
        token: "syt_bot",
      },
    ]);

    const fetchMock: Mock<typeof fetch> = mock();
    fetchMock
      .mockResolvedValueOnce(
        json(200, {
          joined_rooms: [
            ROOM,
          ],
        }),
      )
      .mockResolvedValueOnce(
        json(404, {
          errcode: "M_NOT_FOUND",
        }),
      )
      .mockResolvedValueOnce(
        json(200, {
          event_id: "$state",
        }),
      )
      .mockResolvedValueOnce(
        json(200, {
          joined_rooms: [
            ROOM,
          ],
        }),
      );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const config = {
      hermes_profiles_dir: dir,
      timeout_ms: 1000,
      publish_interval_ms: 60000,
      commands: [
        {
          name: "help",
          syntax: "help",
          description: "Help",
        },
      ],
    } as unknown as BotsSettings;
    const publisher = new BotCommandsPublisher(config, "https://matrix.example.com", silentLogger);

    await publisher.publishAll();
    await publisher.publishAll();

    expect(fetchMock.mock.calls).toHaveLength(4);
    const [url, init] = fetchMock.mock.calls[2] as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      `https://matrix.example.com/_matrix/client/v3/rooms/${encodeURIComponent(ROOM)}/state/${COMMANDS_EVENT_TYPE}/${encodeURIComponent(BOT)}`,
    );
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({
      commands: config.commands,
    });
  });
});
