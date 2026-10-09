import type { Logger } from "winston";

import { HarnessBotsService } from "./harness";
import { BotsService } from "./service";
import type { BotsProvisioner, BotsSettings, SynapseAccess } from "./types";

export interface BotsBackend {
  service: BotsProvisioner;
}

/**
 * The backend of the assistants: Hermes, or the agent harness of the platform.
 * One or the other, as the configuration says (bots.backend): both on one ToM
 * would claim the same accounts.
 */
export const makeBotsBackend = (config: BotsSettings, synapse: SynapseAccess, logger: Logger): BotsBackend => {
  if (config.backend === "harness") {
    if (!config.harness) {
      throw new Error("bots.harness is required when bots.backend is harness");
    }
    return {
      service: new HarnessBotsService(config, config.harness, logger),
    };
  }
  return {
    service: new BotsService(config, synapse, logger),
  };
};
