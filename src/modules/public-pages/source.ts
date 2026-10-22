import type { SynapseAdmin } from "../visio/synapse-admin";
import { aliasSchema, messagesSchema, roomListSchema, stateSchema } from "./schema";
import type { ListedRoom, PagesSource } from "./types";

const ROOM_LIMIT = 500;
/** At most this many pages of the admin list: 50 000 rooms, the limit of one sitemap. */
const ROOM_PAGES = 100;
const MESSAGE_FILTER = encodeURIComponent(
  JSON.stringify({
    types: [
      "m.room.message",
      "m.reaction",
    ],
  }),
);

const clientRoom = (roomId: string): string => `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}`;
const room = (roomId: string): string => `/_synapse/admin/v1/rooms/${encodeURIComponent(roomId)}`;

/** The pages read Synapse as the admin of ToM; the caller must gate everything it returns (`readPage`). */
export const makeSynapseSource = (admin: SynapseAdmin): PagesSource => ({
  async resolveAlias(alias) {
    const body = await admin.readOrNull(`/_matrix/client/v3/directory/room/${encodeURIComponent(alias)}`, aliasSchema);

    return body?.room_id ?? null;
  },
  async readState(roomId) {
    const body = await admin.readOrNull(`${room(roomId)}/state`, stateSchema);

    return body?.state ?? null;
  },
  async readMessages(roomId) {
    const path = `${room(roomId)}/messages?dir=b&limit=100&filter=${MESSAGE_FILTER}`;

    return (await admin.readOrNull(path, messagesSchema))?.chunk ?? [];
  },
  async listRooms() {
    const rooms: ListedRoom[] = [];
    let from: number | null = 0;
    for (let page = 0; from !== null && page < ROOM_PAGES; page++) {
      const body = await admin.readOrNull(`/_synapse/admin/v1/rooms?limit=${ROOM_LIMIT}&from=${from}`, roomListSchema);
      rooms.push(...(body?.rooms ?? []));
      from = body?.next_batch ?? null;
    }

    return rooms;
  },
  async report(roomId, eventId, reason) {
    try {
      await admin.post(`${clientRoom(roomId)}/report/${encodeURIComponent(eventId)}`, {
        reason,
        score: -100,
      });
    } catch {
      // Synapse reports an event only to whoever may see it: the admin of ToM is
      // not in a public room whose history is kept to members. Report the room
      // then, naming the post (MSC4151).
      await admin.post(`${clientRoom(roomId)}/report`, {
        reason: `${reason} (event ${eventId})`,
      });
    }
  },
  download(server, id) {
    return admin.raw(`/_matrix/client/v1/media/download/${encodeURIComponent(server)}/${encodeURIComponent(id)}`);
  },
});
