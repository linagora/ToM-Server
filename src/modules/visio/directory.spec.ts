import { describe, expect, it, type Mock, mock } from "bun:test";

import { TwakeDirectory } from "./directory";

const directoryOf = (
  answer: Promise<Array<Record<string, string | string[]>>>,
): {
  get: Mock<() => Promise<Array<Record<string, string | string[]>>>>;
  directory: TwakeDirectory;
} => {
  const get = mock(() => answer);

  return {
    get,
    directory: new TwakeDirectory(
      {
        get,
      } as never,
      "uid",
      50,
    ),
  };
};

describe("TwakeDirectory", () => {
  it("should read the instance and the email of the user by its uid", async () => {
    // Arrange
    const { get, directory } = directoryOf(
      Promise.resolve([
        {
          twakeWorkspaceUrl: "alice.twake.test",
          mail: "Alice@Twake.test",
        },
      ]),
    );

    // Act
    const entry = await directory.entry("alice");

    // Assert
    expect(entry).toEqual({
      twakeInstance: "alice.twake.test",
      email: "alice@twake.test",
    });
    expect(get).toHaveBeenCalledWith(
      "users",
      [
        "twakeWorkspaceUrl",
        "workspaceurl",
        "mail",
      ],
      {
        uid: "alice",
      },
    );
  });

  it("should fall back on the former attribute", async () => {
    // Arrange
    const { directory } = directoryOf(
      Promise.resolve([
        {
          workspaceurl: "alice.twake.test",
        },
      ]),
    );

    // Act
    const entry = await directory.entry("alice");

    // Assert
    expect(entry.twakeInstance).toBe("alice.twake.test");
  });

  it("should know no email for a user with several", async () => {
    // Arrange
    const { directory } = directoryOf(
      Promise.resolve([
        {
          mail: [
            "alice@twake.test",
            "alice@other.test",
          ],
        },
      ]),
    );

    // Act
    const entry = await directory.entry("alice");

    // Assert
    expect(entry.email).toBeNull();
  });

  it("should know no instance for a user the directory does not have", async () => {
    // Arrange
    const { directory } = directoryOf(Promise.resolve([]));

    // Act
    const entry = await directory.entry("alice");

    // Assert
    expect(entry).toEqual({
      twakeInstance: null,
      email: null,
    });
  });

  it("should give up on a directory that does not answer", async () => {
    // Arrange
    const { directory } = directoryOf(new Promise(() => undefined));

    // Act
    const lookup = directory.entry("alice");

    // Assert
    await expect(lookup).rejects.toThrow("directory timeout");
  });
});
