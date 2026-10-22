import { beforeAll, describe, expect, it } from "bun:test";

import express from "express";
import request from "supertest";
import { createLogger } from "winston";

import { loadMessages } from "../i18n/index";
import { DomainError } from "./domain-error";
import { UNAUTHORIZED } from "./error-codes";
import { errorMiddleware } from "./error-middleware";

const FRENCH = "Authentification requise";
const ENGLISH = "Authentication required";

const setupApp = (locale: string): express.Express => {
  const app = express();
  app.get("/fail", () => {
    throw new DomainError(UNAUTHORIZED, "M_UNAUTHORIZED");
  });
  app.use(
    errorMiddleware({
      locale,
    }),
  );

  return app;
};

async function answer(
  configured: string,
  acceptLanguage?: string,
): Promise<{
  error: string;
  language: string;
}> {
  const call = request(setupApp(configured)).get("/fail");
  const response = await (acceptLanguage === undefined ? call : call.set("Accept-Language", acceptLanguage));

  expect(response.status).toBe(401);

  return {
    error: response.body.error,
    language: response.headers["content-language"],
  };
}

describe("errorMiddleware locale", () => {
  beforeAll(() => {
    loadMessages(
      "assets/i18n",
      createLogger({
        silent: true,
      }),
    );
  });

  it("should take the preferred language that has a catalog, past those that have none", async () => {
    expect(await answer("en", "zh-CN, zh;q=0.9, fr;q=0.8, *;q=0.7")).toEqual({
      error: FRENCH,
      language: "fr",
    });
  });

  it("should order the languages by their q value, not by their place", async () => {
    expect(await answer("en", "en-us;q=0.8, fr;q=0.9, *;q=0.7")).toEqual({
      error: FRENCH,
      language: "fr",
    });
  });

  it("should keep the order of the header between equal q values", async () => {
    expect((await answer("fr", "en, fr")).language).toBe("en");
  });

  it("should match a region tag to its base language, whatever the case and spaces", async () => {
    expect(await answer("en", "  FR-fr ;Q=0.9 , en;q=0.5")).toEqual({
      error: FRENCH,
      language: "fr",
    });
  });

  it("should never take a language refused with q=0", async () => {
    expect((await answer("fr", "fr;q=0, en;q=0.5")).language).toBe("en");
  });

  it("should use the configured locale when the header names no catalog", async () => {
    expect(await answer("fr", "ja")).toEqual({
      error: FRENCH,
      language: "fr",
    });
    expect((await answer("fr", "*")).language).toBe("fr");
  });

  it("should use the configured locale without Accept-Language or with an empty one", async () => {
    expect((await answer("fr")).error).toBe(FRENCH);
    expect((await answer("fr", "")).error).toBe(FRENCH);
  });

  it("should fall back to the default locale when none is configured", async () => {
    expect(await answer("", "ja")).toEqual({
      error: ENGLISH,
      language: "en",
    });
  });
});
