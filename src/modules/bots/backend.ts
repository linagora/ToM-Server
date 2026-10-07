import type { Logger } from "winston";

import { BotCommandsPublisher } from "./commands";
import { BotsService } from "./service";
import type { BotsProvisioner, BotsSettings, SynapseAccess } from "./types";

export interface BotsBackend {
  service: BotsProvisioner;
  /** Hermes announces no command, so ToM does it for the bots it provisioned. */
  commands: BotCommandsPublisher | null;
}

/**
 * The backend of the assistants, as the configuration names it (bots.backend).
 * Hermes only, for now: a ToM configured for the agent harness refuses to start
 * rather than fall back to Hermes, which would claim the same accounts as the
 * harness.
 */
export const makeBotsBackend = (config: BotsSettings, synapse: SynapseAccess, logger: Logger): BotsBackend => {
  if (config.backend === "harness") {
    throw new Error(
      "bots.backend harness is not available in this version of ToM: set bots.backend to hermes or turn bots off",
    );
  }
  return {
    service: new BotsService(config, synapse, logger),
    commands: new BotCommandsPublisher(config, synapse.serverUrl, logger),
  };
};
