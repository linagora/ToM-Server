import type { z } from "zod";

import type { messagesSchema, publicPagesSettingsSchema, roomListSchema, stateSchema } from "./schema";

export type PublicPagesSettings = z.infer<typeof publicPagesSettingsSchema>;
export type StateEvent = z.infer<typeof stateSchema>["state"][number];
export type MessageEvent = z.infer<typeof messagesSchema>["chunk"][number];
export type ListedRoom = z.infer<typeof roomListSchema>["rooms"][number];

export interface Post {
  id: string;
  author: string;
  at: number;
  text: string;
  image: {
    url: string;
    alt: string;
  } | null;
  /** The reactions of the members of the room: count of distinct senders per key. */
  reactions: Record<string, number>;
}

/** What a page shows. `ref` is the slug or the room id of its URL. */
export interface Page {
  ref: string;
  name: string;
  topic: string;
  avatarUrl: string | null;
  coverUrl: string | null;
  accentColor: string;
  followerCount: number;
  posts: Post[];
}

/** The homeserver, as the pages read it: always as the admin, so every call is gated by `readPage`. */
export interface PagesSource {
  /** The room id of a local alias, or null. */
  resolveAlias(alias: string): Promise<string | null>;
  /** The state of a room, or null when it does not exist. */
  readState(roomId: string): Promise<StateEvent[] | null>;
  /** The latest messages of a room, newest first. */
  readMessages(roomId: string): Promise<MessageEvent[]>;
  listRooms(): Promise<ListedRoom[]>;
  /** Report an event to the moderators of the homeserver, as the admin. */
  report(roomId: string, eventId: string, reason: string): Promise<void>;
  download(server: string, id: string): Promise<Response>;
}

/** The reactions of visitors with no account, kept in the database of ToM. */
export interface ReactionStore {
  /** Adds the reaction of a visitor, or removes it when already there; true when it is now there. */
  toggle(roomId: string, eventId: string, key: string, visitorId: string): Promise<boolean>;
  /** Visitor counts per event and key. */
  counts(roomId: string, eventIds: string[]): Promise<Record<string, Record<string, number>>>;
  /** What a visitor reacted with: `eventId` to keys. */
  mine(roomId: string, eventIds: string[], visitorId: string): Promise<Record<string, string[]>>;
}
