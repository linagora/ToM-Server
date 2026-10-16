import type { RequestHandler } from "express";
import type { z } from "zod";

import type { gifsSettingsSchema } from "./schema";

export type GifsSettings = z.infer<typeof gifsSettingsSchema>;

export type Variant = "preview" | "full";

/** What the client gets for one GIF; both URLs point at the media proxy of ToM. */
export interface Gif {
  id: string;
  title: string;
  preview_url: string;
  url: string;
  width: number;
  height: number;
}

export interface GifPage {
  results: Gif[];
  /** The next page number, null on the last page. */
  next_page: number | null;
}

/** The run time switch, kept in the database of ToM. */
export interface GifsFlag {
  /** undefined when the admin never set it. */
  get: () => Promise<boolean | undefined>;
  set: (enabled: boolean) => Promise<void>;
}

export interface GifsDeps {
  authenticate: RequestHandler;
  rateLimit: RequestHandler;
  /** `checkAdminSettingsToken` of the admin API. */
  authenticateAdmin: RequestHandler;
}
