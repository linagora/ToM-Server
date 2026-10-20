import type { UserDBBackend } from "../legacy/matrix-identity-server/userdb/index";

/**
 * The Twake Workplace instance of a Matrix user, read in the directory: Meet saves
 * the recordings and transcripts there, for a user who never signs in to Meet.
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
  async twakeInstance(uid: string): Promise<string | null> {
    const lookup = this.#userDb.get(
      "users",
      [
        "twakeWorkspaceUrl",
        "workspaceurl",
      ],
      {
        [this.#uidField]: uid,
      },
    ) as Promise<Array<Record<string, string | undefined>>>;
    const [row] = await Promise.race([
      lookup,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("directory timeout")), this.#timeoutMs).unref();
      }),
    ]);

    // `workspaceurl` is the older name of `twakeWorkspaceUrl`
    return row?.twakeWorkspaceUrl || row?.workspaceurl || null;
  }
}
