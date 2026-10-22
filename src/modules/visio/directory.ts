import type { UserDBBackend } from "../legacy/matrix-identity-server/userdb/index";

/** What the directory knows of a Matrix user, for Meet. */
export interface DirectoryEntry {
  /** The Twake Workplace instance: Meet saves the recordings and transcripts there. */
  twakeInstance: string | null;
  /** The single email of the user, null when it has none or several. */
  email: string | null;
}

type Value = string | string[] | undefined;

/** An LDAP attribute holds one value or several. */
const single = (value: Value): string | null => {
  const values = Array.isArray(value)
    ? value
    : [
        value,
      ];

  return values.length === 1 && values[0] ? values[0] : null;
};

/**
 * A Matrix user read in the directory of the Twake Workplace, for a user who never
 * signs in to Meet. The directory is the source of the email: Synapse may hold none.
 */
export class TwakeDirectory {
  #userDb: Pick<UserDBBackend, "get">;
  #uidField: string;
  #timeoutMs: number;

  constructor(userDb: Pick<UserDBBackend, "get">, uidField: string, timeoutMs: number) {
    this.#userDb = userDb;
    this.#uidField = uidField;
    this.#timeoutMs = timeoutMs;
  }

  /** Rejects when the directory does not answer in time: the LDAP client has no timeout of its own. */
  async entry(uid: string): Promise<DirectoryEntry> {
    const lookup = this.#userDb.get(
      "users",
      [
        "twakeWorkspaceUrl",
        "workspaceurl",
        "mail",
      ],
      {
        [this.#uidField]: uid,
      },
    ) as Promise<Array<Record<string, Value>>>;
    const [row] = await Promise.race([
      lookup,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("directory timeout")), this.#timeoutMs).unref();
      }),
    ]);

    return {
      // `workspaceurl` is the older name of `twakeWorkspaceUrl`
      twakeInstance: single(row?.twakeWorkspaceUrl) || single(row?.workspaceurl) || null,
      email: single(row?.mail)?.toLowerCase() ?? null,
    };
  }
}
