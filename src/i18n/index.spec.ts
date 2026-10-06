import { beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { load } from "js-yaml";
import { createLogger } from "winston";

import { loadMessages, resolveMessage, translate } from "./index";

const silentLogger = createLogger({
  silent: true,
});

const I18N_DIR = "assets/i18n";

function readLocale(file: string): Record<string, string> {
  return load(readFileSync(resolve(I18N_DIR, file), "utf-8")) as Record<string, string>;
}

function placeholders(message: string): string[] {
  return [...message.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1] ?? "").sort();
}

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
  beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), "tom-i18n-"));
    writeFileSync(join(dir, "en.yaml"), 'ONLY_EN: "English only"\nBOTH: "Both"\n');
    writeFileSync(join(dir, "xx.yaml"), 'BOTH: "Les deux"\n');
    loadMessages(dir, silentLogger);
  });

  it("should fall back to English for a key missing from a locale", () => {
    expect(resolveMessage("xx", "BOTH")).toBe("Les deux");
    expect(resolveMessage("xx", "ONLY_EN")).toBe("English only");
  });

  it("should return the key when no locale knows it", () => {
    expect(resolveMessage("xx", "NOWHERE")).toBe("NOWHERE");
  });
});

describe("i18n catalogs", () => {
  const source = readLocale("en.yaml");
  const locales = readdirSync(I18N_DIR).filter((f) => f.endsWith(".yaml") && f !== "en.yaml");

  for (const file of locales) {
    const target = readLocale(file);

    it(`${file} should have the same keys as en.yaml`, () => {
      expect(Object.keys(target)).toEqual(Object.keys(source));
    });

    it(`${file} should keep the placeholders of en.yaml`, () => {
      for (const [key, message] of Object.entries(source)) {
        expect(typeof target[key]).toBe("string");
        expect(target[key]?.trim()).not.toBe("");
        expect(placeholders(target[key] ?? "")).toEqual(placeholders(message));
      }
    });
  }
});
