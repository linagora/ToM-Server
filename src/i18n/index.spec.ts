import { beforeAll, describe, expect, it } from "bun:test";

import { createLogger } from "winston";

import { loadMessages, resolveMessage, translate } from "./index";

const silentLogger = createLogger({
  silent: true,
});

describe("i18n", () => {
  beforeAll(() => {
    loadMessages("assets/i18n", silentLogger);
  });

  it("should resolve a key in the requested locale", () => {
    expect(resolveMessage("fr-FR", "M_UNAUTHORIZED")).toBe("Authentification requise");
  });

  it("should translate in English", () => {
    expect(translate("M_UNAUTHORIZED")).toBe("Authentication required");
  });
});
