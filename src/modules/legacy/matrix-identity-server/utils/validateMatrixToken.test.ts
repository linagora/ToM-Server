import { beforeEach, describe, expect, it, mock } from "bun:test";

let userInfo: unknown = {};
mock.module("node-fetch", () => ({
  default: async () => ({ json: async () => userInfo }),
}));
mock.module("../../matrix-resolve/index", () => ({
  MatrixResolve: class {
    async resolve(): Promise<string> {
      return "https://hs.test/";
    }
  },
}));

const { default: validateMatrixToken } = await import("./validateMatrixToken");

const logger = { warn: mock(), info: mock(), error: mock() };
const validate = validateMatrixToken(logger as never);

describe("validateMatrixToken", () => {
  beforeEach(() => {
    userInfo = {};
  });

  it("accepts a sub of the queried server", async () => {
    userInfo = { sub: "@alice:example.org" };
    expect(await validate("example.org", "tok")).toBe("@alice:example.org");
  });

  it("accepts a sub of the queried server with a port", async () => {
    userInfo = { sub: "@alice:example.org:8448" };
    expect(await validate("example.org:8448", "tok")).toBe("@alice:example.org:8448");
  });

  it("rejects a sub of another domain (forged identity)", async () => {
    userInfo = { sub: "@alice:localhost" };
    await expect(validate("evil.example", "tok")).rejects.toBe("Invalid response from Matrix Server");
  });

  it("rejects a sub whose port differs", async () => {
    userInfo = { sub: "@alice:example.org:9999" };
    await expect(validate("example.org:8448", "tok")).rejects.toBe("Invalid response from Matrix Server");
  });

  it("rejects a response without sub", async () => {
    await expect(validate("example.org", "tok")).rejects.toBe("Invalid server");
  });

  it("rejects a sub with a colon-injected server part", async () => {
    userInfo = { sub: "@victim:real.example:evil.example" };
    await expect(validate("evil.example", "tok")).rejects.toBe("Invalid response from Matrix Server");
  });

  it("rejects a sub whose domain only differs by a prefix", async () => {
    userInfo = { sub: "@alice:notexample.org" };
    await expect(validate("example.org", "tok")).rejects.toBe("Invalid response from Matrix Server");
  });
});
