import { describe, expect, it } from "bun:test";

import { visioRoomResponseSchema, visioSettingsSchema, visioTokenResponseSchema } from "./schema";

const enabledConfig = {
  enabled: true,
  base_url: "https://visio.example.com",
  client_id: "tom",
  client_secret: "s3cret",
};

describe("visioSettingsSchema", () => {
  it("should apply defaults and stay disabled on an empty section", () => {
    const result = visioSettingsSchema.safeParse({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        enabled: false,
        timeout_ms: 10000,
      });
    }
  });

  it("should parse a missing section once prefaulted", () => {
    const result = visioSettingsSchema.prefault({}).safeParse(undefined);

    expect(result.success).toBe(true);
  });

  it("should reject an unknown room_access_level", () => {
    const result = visioSettingsSchema.safeParse({
      room_access_level: "secret",
    });

    expect(result.success).toBe(false);
  });

  it("should reject a non-positive timeout_ms", () => {
    const result = visioSettingsSchema.safeParse({
      timeout_ms: 0,
    });

    expect(result.success).toBe(false);
  });
});

describe("visioSettingsSchema when enabled", () => {
  it("should parse a complete configuration", () => {
    const result = visioSettingsSchema.safeParse({
      ...enabledConfig,
      room_access_level: "trusted",
      timeout_ms: 2000,
    });

    expect(result.success).toBe(true);
  });

  it("should require base_url, client_id and client_secret", () => {
    const result = visioSettingsSchema.safeParse({
      enabled: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toEqual([
        "visio.base_url is required when visio.enabled is true",
        "visio.client_id is required when visio.enabled is true",
        "visio.client_secret is required when visio.enabled is true",
      ]);
    }
  });

  it("should reject an empty secret", () => {
    const result = visioSettingsSchema.safeParse({
      ...enabledConfig,
      client_secret: "",
    });

    expect(result.success).toBe(false);
  });

  it("should reject an invalid base_url", () => {
    const result = visioSettingsSchema.safeParse({
      ...enabledConfig,
      base_url: "not-a-url",
    });

    expect(result.success).toBe(false);
  });
});

describe("visioTokenResponseSchema", () => {
  it("should require a non-empty access_token", () => {
    const parse = (value: unknown): boolean => visioTokenResponseSchema.safeParse(value).success;

    expect(
      parse({
        access_token: "jwt",
      }),
    ).toBe(true);
    expect(
      parse({
        access_token: "",
      }),
    ).toBe(false);
    expect(parse({})).toBe(false);
  });
});

describe("visioRoomResponseSchema", () => {
  it("should keep only the url", () => {
    const result = visioRoomResponseSchema.safeParse({
      id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      slug: "abc-defg-hij",
      url: "https://visio.example.com/abc-defg-hij",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        url: "https://visio.example.com/abc-defg-hij",
      });
    }
  });

  it("should reject a room without a valid url", () => {
    const parse = (value: unknown): boolean => visioRoomResponseSchema.safeParse(value).success;

    expect(
      parse({
        slug: "abc-defg-hij",
      }),
    ).toBe(false);
    expect(
      parse({
        url: "abc-defg-hij",
      }),
    ).toBe(false);
  });
});
