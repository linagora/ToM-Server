import { createHmac } from "node:crypto";

export interface LivekitTokenInput {
  apiKey: string;
  apiSecret: string;
  /** The LiveKit room name. */
  room: string;
  identity: string;
  name: string;
  ttlSeconds: number;
  attributes?: Record<string, string>;
  /** `now` in seconds, for the tests. */
  now?: number;
}

const base64url = (input: string | Buffer): string => Buffer.from(input).toString("base64url");

/**
 * A LiveKit access token (JWT HS256), as livekit-server-sdk signs it: the key id
 * as issuer, the identity as subject, the room grants in `video`. Used when ToM
 * stands in for Meet (degraded mode, D30 D-d): no dependency needed for a
 * twenty-line signature.
 */
export function signLivekitToken(input: LivekitTokenInput): string {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const header = base64url(
    JSON.stringify({
      alg: "HS256",
      typ: "JWT",
    }),
  );
  const payload = base64url(
    JSON.stringify({
      iss: input.apiKey,
      sub: input.identity,
      name: input.name,
      nbf: now,
      exp: now + input.ttlSeconds,
      video: {
        room: input.room,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      },
      ...(input.attributes && {
        attributes: input.attributes,
      }),
    }),
  );
  const signature = base64url(createHmac("sha256", input.apiSecret).update(`${header}.${payload}`).digest());

  return `${header}.${payload}.${signature}`;
}

/** The claims of a JWT, read without checking the signature (the token comes from a trusted service). */
export function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split(".")[1] ?? "";
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));

    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
