import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLogger } from "winston";

import { loadMessages, resolveMessage, translate } from "./index";

const silentLogger = createLogger({
  silent: true,
});

const I18N_DIR = "assets/i18n";

describe("i18n", () => {
  beforeAll(() => {
    loadMessages(I18N_DIR, silentLogger);
  });

  it("should resolve a key in the requested locale", () => {
    expect(resolveMessage("fr-FR", "M_UNAUTHORIZED")).toBe("Authentification requise");
  });

  it("should resolve a key in the base language", () => {
    expect(resolveMessage("fr", "M_UNAUTHORIZED")).toBe("Authentification requise");
  });

  it("should fall back to English for an unknown locale", () => {
    expect(resolveMessage("ja-JP", "M_UNAUTHORIZED")).toBe("Authentication required");
  });

  it("should translate in English", () => {
    expect(translate("M_UNAUTHORIZED")).toBe("Authentication required");
  });
});

describe("i18n fallback", () => {
  let dir = "";

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "tom-i18n-"));
    writeFileSync(join(dir, "en.yaml"), 'ONLY_EN: "English only"\nBOTH: "Both"\n');
    writeFileSync(join(dir, "xx.yaml"), 'BOTH: "Les deux"\n');
    loadMessages(dir, silentLogger);
  });

  // The fake catalogs replace the real ones for the whole file: put them back.
  afterAll(() => {
    loadMessages(I18N_DIR, silentLogger);
    rmSync(dir, {
      recursive: true,
      force: true,
    });
  });

  it("should fall back to English for a key missing from a locale", () => {
    expect(resolveMessage("xx", "BOTH")).toBe("Les deux");
    expect(resolveMessage("xx", "ONLY_EN")).toBe("English only");
  });

  it("should return the key when no locale knows it", () => {
    expect(resolveMessage("xx", "NOWHERE")).toBe("NOWHERE");
  });
});
