# Bots: the assistants of the users

One assistant per user, as Twake Chat expects (its DECISION.md D27): a Matrix
account `@bot_<localpart>` with one device on the shared Hermes agent, that
only its owner may invoke, invite, or see the commands of. Direct rooms with
it are encrypted; the client trusts the device of the bot from the master key
this module attests.

## Route

`POST /_twake/v1/bots/me` — `Authorization: Bearer <Matrix access token of the user>`.

| Answer | When |
|---|---|
| `200 { userId, deviceId, masterKey }` | The bot exists and has published its keys. Idempotent. |
| `503 M_SERVICE_UNAVAILABLE` | The bot was just provisioned, Hermes has not published its keys yet: call again in a moment. |
| `502 M_BAD_GATEWAY` | The homeserver refused or could not be reached. |
| `404 M_NOT_FOUND` | `bots.enabled` is false: the client hides the action. |
| `401 M_UNAUTHORIZED` | No valid token. |

`masterKey` is the public master cross-signing key of the bot, the value in
`master_keys[<bot>].keys` of `/keys/query`; the client compares it with what
the homeserver publishes before marking the device verified.

## What a first call does

1. `PUT /_synapse/admin/v2/users/@bot_<localpart>:<server>` (`user_type: bot`,
   not an admin) with the admin of `synapse.admin`.
2. Logs the bot in with the fixed device id `HERMES<LOCALPART>`.
3. Writes the Hermes profile `<hermes_profiles_dir>/bot_<localpart>/`:
   `.env` (homeserver, token, device, `MATRIX_E2EE_MODE=optional`,
   `MATRIX_RECOVERY_KEY_OUTPUT_FILE`, `MATRIX_ALLOWED_USERS=<owner>`, the model
   key), `config.yaml` (the model), `SOUL.md`. Mode 0600. The token of the bot
   lives there and nowhere else: ToM keeps no table.
4. Waits up to `ready_timeout_ms` for the keys of the bot: Hermes, started on
   the profile, makes the cross-signing identity itself and publishes its
   device. Not there yet: `503`.

Hermes learns about a new profile at its start (the container boot
reconciles `$HERMES_HOME/profiles`, `hermes profile create` registers at run
time): the deployment restarts the agent, or runs its profile reconciliation,
after a provisioning. Until that is automated, the first `bots/me` of a user
answers `503` and the next one, after the restart, `200`.

## Commands (MSC4332)

Hermes announces no command. Every `publish_interval_ms`, ToM writes the
state `org.matrix.msc4332.commands` (state key: the id of the bot, content:
`bots.commands`) in every room each provisioned bot is in, once per room.
Rooms created by Twake Chat let any member write it; other rooms need the
moderator, and are tried again at the next round.

## Configuration

See `.tomconfig.example.yaml`, section `bots`. `hermes_profiles_dir` is the
`profiles` directory of the Hermes home, shared with the agent (a volume).
`hermes_homeserver_url` is the homeserver as the agent reaches it, and
`hermes_home` the home of the agent as the agent sees it (the paths written in
a profile, such as the recovery key file, are for the agent).
