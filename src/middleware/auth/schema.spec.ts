import { describe, expect, it } from "bun:test";

import { authSettingsSchema } from "./schema";

describe("authSettingsSchema", () => {
  it("should apply defaults on an empty section", () => {
    const result = authSettingsSchema.safeParse({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        token_cache_size: 1000,
        token_cache_ttl_ms: 60000,
        timeout_ms: 10000,
      });
    }
  });

  it("should reject a non positive cache size", () => {
    const result = authSettingsSchema.safeParse({
      token_cache_size: 0,
    });

    expect(result.success).toBe(false);
  });
});
