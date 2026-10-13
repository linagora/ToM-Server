import type Database from "../legacy/db/database";

export const CALL_ROOMS_TABLE = "visio_call_rooms";
export const CALL_ROOMS_SCHEMA: Record<typeof CALL_ROOMS_TABLE, string> = {
  visio_call_rooms: "matrix_room_id varchar(255) PRIMARY KEY, meet_room_id varchar(64) NOT NULL",
};

/** The Meet room of each Matrix room, shared by every ToM replica and kept across restarts. */
export interface CallRooms {
  get(matrixRoomId: string): Promise<string | undefined>;
  /** Records the Meet room; when another replica was first, returns its room instead. */
  add(matrixRoomId: string, meetRoomId: string): Promise<string>;
}

export class DbCallRooms implements CallRooms {
  #db: Database<typeof CALL_ROOMS_TABLE>;

  constructor(db: Database<typeof CALL_ROOMS_TABLE>) {
    this.#db = db;
  }

  async get(matrixRoomId: string): Promise<string | undefined> {
    const rows = await this.#db.get(
      CALL_ROOMS_TABLE,
      [
        "meet_room_id",
      ],
      {
        matrix_room_id: matrixRoomId,
      },
    );

    return rows[0] === undefined ? undefined : String(rows[0].meet_room_id);
  }

  async add(matrixRoomId: string, meetRoomId: string): Promise<string> {
    try {
      await this.#db.insert(CALL_ROOMS_TABLE, {
        matrix_room_id: matrixRoomId,
        meet_room_id: meetRoomId,
      });

      return meetRoomId;
    } catch (err) {
      // The primary key refused: another replica made the room first, keep its room
      const winner = await this.get(matrixRoomId);
      if (winner === undefined) {
        throw err;
      }

      return winner;
    }
  }
}
