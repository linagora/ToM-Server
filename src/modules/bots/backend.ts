import type { Logger } from "winston";

import { HarnessBotsService } from "./harness";
import { BotsService } from "./service";
import type { BotsProvisioner, BotsSettings, SynapseAccess } from "./types";

/**
 * The backend of the assistants: Hermes, or the agent harness of the platform.
 * One or the other, as the configuration says (bots.backend): both on one ToM
 * would claim the same accounts.
 */
export const makeBotsBackend = (config: BotsSettings, synapse: SynapseAccess, logger: Logger): BotsProvisioner => {
  if (config.backend === "harness") {
    if (!config.harness) {
      throw new Error("bots.harness is required when bots.backend is harness");
    }
    return new HarnessBotsService(config, config.harness, logger);
  }
  return new BotsService(config, synapse, logger);
};
