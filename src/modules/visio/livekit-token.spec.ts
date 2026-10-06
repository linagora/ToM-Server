import { describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";

import { decodeJwtPayload, signLivekitToken } from "./livekit-token";

describe("signLivekitToken", () => {
  const input = {
    apiKey: "devkey",
    apiSecret: "secret",
    room: "!room:localhost",
    identity: "@alice:localhost:DEVICE",
    name: "Alice",
    ttlSeconds: 3600,
    attributes: {
      matrix_user_id: "@alice:localhost",
    },
    now: 1_700_000_000,
  };

  it("should sign the LiveKit grants with HMAC-SHA256 under the api key", () => {
    // Act
    const token = signLivekitToken(input);

    // Assert
    const [header, payload, signature] = token.split(".");
    expect(JSON.parse(Buffer.from(header ?? "", "base64url").toString())).toEqual({
      alg: "HS256",
      typ: "JWT",
    });
    expect(decodeJwtPayload(token)).toEqual({
      iss: "devkey",
      sub: "@alice:localhost:DEVICE",
      name: "Alice",
      nbf: 1_700_000_000,
      exp: 1_700_003_600,
      video: {
        room: "!room:localhost",
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      },
      attributes: {
        matrix_user_id: "@alice:localhost",
      },
    });
    const expected = createHmac("sha256", "secret").update(`${header}.${payload}`).digest("base64url");
    expect(signature).toBe(expected);
  });

  it("should read nothing from a token that is not a JWT", () => {
    expect(decodeJwtPayload("nope")).toEqual({});
    expect(decodeJwtPayload("a.b.c")).toEqual({});
  });
});
