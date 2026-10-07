import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { load } from "js-yaml";

import { botsSettingsSchema } from "./schema";

/**
 * The commented `bots` section of .tomconfig.example.yaml starting with `first`,
 * uncommented as a deployer would, up to the first line that is no comment.
 */
const exampleSection = (first: string): Record<string, unknown> => {
  const text = readFileSync(join(import.meta.dir, "../../../.tomconfig.example.yaml"), "utf8");
  const block: string[] = [];
  for (const line of text.slice(text.indexOf(first)).split("\n")) {
    if (!line.startsWith("#")) break;
    block.push(line.replace(/^# ?/, ""));
  }
  return (
    load(block.join("\n")) as {
      bots: Record<string, unknown>;
    }
  ).bots;
};

const harness = {
  url: "https://gateway.example.com/agents",
  token_url: "https://auth.example.com/oauth2/token",
  client_id: "tom",
  client_secret: "s3cret",
};

const issuesOf = (input: unknown): string[] => {
  const result = botsSettingsSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
};

describe("bots settings", () => {
  it("serves the assistants from the harness when the backend says so, with no Hermes profile", () => {
    const result = botsSettingsSchema.safeParse({
      enabled: true,
      backend: "harness",
      harness,
    });

    expect(result.success).toBe(true);
    expect(result.data?.backend).toBe("harness");
  });

  it("refuses the harness backend without the way to reach the harness", () => {
    expect(
      issuesOf({
        enabled: true,
        backend: "harness",
      }),
    ).toEqual([
      "bots.harness is required when bots.backend is harness",
    ]);
  });

  it("refuses a Hermes profile directory on a ToM the harness serves", () => {
    expect(
      issuesOf({
        enabled: true,
        backend: "harness",
        harness,
        hermes_profiles_dir: "/opt/hermes/profiles",
      }),
    ).toEqual([
      "a ToM served by the harness runs no Hermes profile: unset bots.hermes_profiles_dir",
    ]);
  });

  it("keeps Hermes as the backend by default, and refuses the harness next to it", () => {
    const hermes = botsSettingsSchema.safeParse({
      enabled: true,
      hermes_profiles_dir: "/opt/hermes/profiles",
    });

    expect(hermes.success).toBe(true);
    expect(hermes.data?.backend).toBe("hermes");
    expect(
      issuesOf({
        enabled: true,
        hermes_profiles_dir: "/opt/hermes/profiles",
        harness,
      }),
    ).toEqual([
      "bots.harness is only read when bots.backend is harness: Hermes and the harness never serve one ToM together",
    ]);
  });

  it("accepts the example of .tomconfig.example.yaml once uncommented and enabled", () => {
    expect(
      issuesOf({
        ...exampleSection("# bots:\n"),
        enabled: true,
      }),
    ).toEqual([]);
  });

  it("accepts the harness example of .tomconfig.example.yaml once uncommented", () => {
    const example = exampleSection("# bots:\n#   enabled: true\n#   backend: harness");

    expect(issuesOf(example)).toEqual([]);
    expect(example.backend).toBe("harness");
  });
});
