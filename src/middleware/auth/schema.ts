import { z } from "zod";

export const whoamiSchema = z.object({
  user_id: z.string().min(1),
});

export const threepidsSchema = z.object({
  threepids: z.array(
    z.object({
      medium: z.string(),
      address: z.string(),
    }),
  ),
});
