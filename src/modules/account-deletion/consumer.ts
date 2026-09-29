/**
 * @file Erases the Matrix account of a user deleted in the directory.
 *
 * The same consumer serves both deployments, only its binding differs: a
 * shared server binds `auth` / `user.deleted`, a tenant binds
 * `user.deleted.<organization id>` on the exchange its control plane forwards
 * to. A handler that throws is retried, then dead-lettered by the client.
 */

import type { Logger } from "winston";

import { RabbitMQClient, type RabbitMQMessageHandler } from "@linagora/rabbitmq-client";

import type { Config } from "../../config/types";
import { mapToLegacyConfig } from "../legacy/router";
import DeactivateAccountService from "../legacy/tom-server/deactivate-account-api/services/index";
import { toMatrixId } from "../legacy/utils/index";

type EraseAccount = (matrixId: string) => Promise<void>;
type LocalpartFrom = Config["account_deletion"]["localpart_from"];

const ASCII_UPPER_A = 0x41;
const ASCII_UPPER_Z = 0x5a;
const ASCII_CASE_OFFSET = 0x20;
const MXID_LOCALPART_CHARACTER = /^[a-z0-9._/+-]$/;

/**
 * The localpart Synapse gives an SSO user whose login is `username`, following
 * its `map_username_to_mxid_localpart`: ASCII letters lowercased, any other
 * byte outside the localpart grammar escaped as `=xx`, and a leading `_`
 * escaped too.
 */
export function toSynapseLocalpart(username: string): string {
  let localpart = "";

  for (const byte of new TextEncoder().encode(username)) {
    const lowered = byte >= ASCII_UPPER_A && byte <= ASCII_UPPER_Z ? byte + ASCII_CASE_OFFSET : byte;
    const character = String.fromCharCode(lowered);
    localpart += MXID_LOCALPART_CHARACTER.test(character) ? character : `=${lowered.toString(16).padStart(2, "0")}`;
  }

  return localpart.replace(/^_/, "=5f");
}

/**
 * The login Synapse's SSO mapping built the localpart from: the directory uid
 * (`preferred_username`) or the local part of the email (`sub`).
 */
function loginOf(message: Record<string, unknown>, localpartFrom: LocalpartFrom): string {
  if (localpartFrom === "uid") {
    const { userId } = message;
    if (typeof userId !== "string" || userId === "") {
      throw new Error("user.deleted: the message has no userId");
    }
    return userId;
  }

  const { internalEmail } = message;
  const at = typeof internalEmail === "string" ? internalEmail.indexOf("@") : -1;
  if (typeof internalEmail !== "string" || at <= 0) {
    throw new Error("user.deleted: the message has no internalEmail");
  }
  return internalEmail.slice(0, at);
}

export function createUserDeletedHandler(
  eraseAccount: EraseAccount,
  serverName: string,
  localpartFrom: LocalpartFrom,
  logger: Logger,
): RabbitMQMessageHandler {
  return async (message, { messageId }): Promise<void> => {
    const matrixId = toMatrixId(toSynapseLocalpart(loginOf(message, localpartFrom)), serverName);
    await eraseAccount(matrixId);

    logger.info("user.deleted: Matrix account erased", {
      matrixId,
      messageId,
    });
  };
}

export async function startAccountDeletionConsumer(
  config: Config,
  logger: Logger,
): Promise<RabbitMQClient | undefined> {
  const settings = config.account_deletion;
  if (!settings.enabled) return undefined;

  const service = new DeactivateAccountService(mapToLegacyConfig(config), logger);
  const client = new RabbitMQClient({
    url: settings.rabbitmq_url,
    maxRetries: settings.max_retries,
    logger,
  });

  await client.init();
  await client.subscribe(
    settings.exchange,
    settings.routing_key,
    settings.queue,
    createUserDeletedHandler(service.removeAccount, config.server.name, settings.localpart_from, logger),
  );
  logger.info(`Consuming ${settings.exchange} / ${settings.routing_key} on ${settings.queue}`);

  return client;
}
