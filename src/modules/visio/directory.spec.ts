import { describe, expect, it, type Mock, mock } from "bun:test";

import { TwakeDirectory } from "./directory";

const directoryOf = (
  answer: Promise<Array<Record<string, string>>>,
): {
  get: Mock<() => Promise<Array<Record<string, string>>>>;
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
  it("should read the instance of the user by its uid", async () => {
    // Arrange
    const { get, directory } = directoryOf(
      Promise.resolve([
        {
          twakeWorkspaceUrl: "alice.twake.test",
        },
      ]),
    );

    // Act
    const instance = await directory.twakeInstance("alice");

    // Assert
    expect(instance).toBe("alice.twake.test");
    expect(get).toHaveBeenCalledWith(
      "users",
      [
        "twakeWorkspaceUrl",
        "workspaceurl",
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
    const instance = await directory.twakeInstance("alice");

    // Assert
    expect(instance).toBe("alice.twake.test");
  });

  it("should know no instance for a user the directory does not have", async () => {
    // Arrange
    const { directory } = directoryOf(Promise.resolve([]));

    // Act
    const instance = await directory.twakeInstance("alice");

    // Assert
    expect(instance).toBeNull();
  });

  it("should give up on a directory that does not answer", async () => {
    // Arrange
    const { directory } = directoryOf(new Promise(() => undefined));

    // Act
    const lookup = directory.twakeInstance("alice");

    // Assert
    await expect(lookup).rejects.toThrow("directory timeout");
  });
});
