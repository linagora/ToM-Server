import type Database from "../legacy/db/database";
import type { GifsFlag } from "./types";

export const FLAGS_TABLE = "feature_flags";
export const FLAGS_SCHEMA: Record<typeof FLAGS_TABLE, string> = {
  feature_flags: "name varchar(64) PRIMARY KEY, enabled integer NOT NULL",
};
const NAME = "gifs";

/** The switch of the GIFs in the database of ToM (`feature_flags`). */
export class DbGifsFlag implements GifsFlag {
  #db: Database<typeof FLAGS_TABLE>;

  constructor(db: Database<typeof FLAGS_TABLE>) {
    this.#db = db;
  }

  async get(): Promise<boolean | undefined> {
    const rows = await this.#db.get(
      FLAGS_TABLE,
      [
        "enabled",
      ],
      {
        name: NAME,
      },
    );
    const row = rows[0];

    return row === undefined ? undefined : Number(row.enabled) === 1;
  }

  async set(enabled: boolean): Promise<void> {
    const values = {
      enabled: enabled ? 1 : 0,
    };
    if ((await this.get()) === undefined) {
      await this.#db.insert(FLAGS_TABLE, {
        name: NAME,
        ...values,
      });
    } else {
      await this.#db.update(FLAGS_TABLE, values, "name", NAME);
    }
  }
}
