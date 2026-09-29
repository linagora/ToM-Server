import { describe, expect, it, mock } from "bun:test";

import { createLogger } from "winston";

import type { Config } from "../../config/types";
import { createUserDeletedHandler, startAccountDeletionConsumer, toSynapseLocalpart } from "./consumer";

const silentLogger = createLogger({
  silent: true,
});

const properties = {
  headers: {},
  messageId: "message-1",
};

describe("toSynapseLocalpart", () => {
  // Expected values are what Synapse's map_username_to_mxid_localpart returns.
  it.each([
    [
      "John.Doe",
      "john.doe",
    ],
    [
      "user+tag",
      "user+tag",
    ],
    [
      "x/y-z_1",
      "x/y-z_1",
    ],
    [
      "_hidden",
      "=5fhidden",
    ],
    [
      "élodie",
      "=c3=a9lodie",
    ],
    [
      "a=b",
      "a=3db",
    ],
    [
      "Bob O'Neil",
      "bob=20o=27neil",
    ],
  ])("maps %p like Synapse", (username, localpart) => {
    expect(toSynapseLocalpart(username)).toBe(localpart);
  });
});

describe("createUserDeletedHandler", () => {
  const deleted = {
    userId: "User-1790342743145-tn641o",
    internalEmail: "Alice.Martin@acme.example",
    reasonCode: "user_request",
  };

  it("erases the Matrix account Synapse gave the user's uid", async () => {
    const eraseAccount = mock(async () => {});
    const handler = createUserDeletedHandler(eraseAccount, "example.com", "uid", silentLogger);

    await handler(deleted, properties);

    expect(eraseAccount).toHaveBeenCalledWith("@user-1790342743145-tn641o:example.com");
  });

  it("erases the Matrix account Synapse gave the user's email", async () => {
    const eraseAccount = mock(async () => {});
    const handler = createUserDeletedHandler(eraseAccount, "example.com", "email", silentLogger);

    await handler(deleted, properties);

    expect(eraseAccount).toHaveBeenCalledWith("@alice.martin:example.com");
  });

  it.each([
    [
      "uid",
      {
        internalEmail: "alice@example.com",
      },
    ],
    [
      "email",
      {
        userId: "alice",
      },
    ],
  ] as const)("rejects a message without the %s login, so it is dead-lettered", async (localpartFrom, message) => {
    const eraseAccount = mock(async () => {});
    const handler = createUserDeletedHandler(eraseAccount, "example.com", localpartFrom, silentLogger);

    await expect(handler(message, properties)).rejects.toThrow();
    expect(eraseAccount).not.toHaveBeenCalled();
  });

  it("fails when the erasure fails, so the message is retried", async () => {
    const eraseAccount = mock(() => Promise.reject(new Error("Synapse answered 500")));
    const handler = createUserDeletedHandler(eraseAccount, "example.com", "email", silentLogger);

    await expect(
      handler(
        {
          internalEmail: "alice@example.com",
        },
        properties,
      ),
    ).rejects.toThrow("Synapse answered 500");
  });
});

describe("startAccountDeletionConsumer", () => {
  it("does not connect when disabled", async () => {
    const config = {
      account_deletion: {
        enabled: false,
      },
    } as Config;

    expect(await startAccountDeletionConsumer(config, silentLogger)).toBeUndefined();
  });
});
