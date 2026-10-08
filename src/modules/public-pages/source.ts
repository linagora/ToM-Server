import type { SynapseAdmin } from "../visio/synapse-admin";
import { aliasSchema, messagesSchema, roomListSchema, stateSchema } from "./schema";
import type { PagesSource } from "./types";

const ROOM_LIMIT = 500;
const MESSAGE_FILTER = encodeURIComponent(
  JSON.stringify({
    types: [
      "m.room.message",
    ],
  }),
);

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
    return (await admin.readOrNull(`/_synapse/admin/v1/rooms?limit=${ROOM_LIMIT}`, roomListSchema))?.rooms ?? [];
  },
  download(server, id) {
    return admin.raw(`/_matrix/client/v1/media/download/${encodeURIComponent(server)}/${encodeURIComponent(id)}`);
  },
});
