# Bots: the assistants of the users

One assistant per user, as Twake Chat expects (its DECISION.md D27): a Matrix
account `@bot_<localpart>` with one device on the shared Hermes agent, that
only its owner may invoke, invite, or see the commands of. Direct rooms with
it are encrypted; the client trusts the device of the bot from the master key
this module attests.

## Route

`POST /_twake/v1/bots/me` — `Authorization: Bearer <Matrix access token of the user>`,
optional body `{ "timezone": "Europe/Paris" }` (the IANA zone of the browser).

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

Hermes (v0.21.5 and later, `gateway.multiplex_profiles: true`) reads
`$HERMES_HOME/profiles` every 30 s and serves a new profile with no restart.
The first `bots/me` of a user may answer `503` in the meantime: the client
tries again until `200`.

## Timezone

The client sends the timezone of the browser with every `bots/me`. ToM writes
it as `timezone:` in the `config.yaml` of the profile, where Hermes reads it
under `multiplex_profiles` (`HERMES_TIMEZONE` speaks for the default profile
only): the clock of the agent and of its cron jobs. The file is rewritten only
when the zone changes; something that is not a zone name is ignored. Hermes
caches the zone of a profile once read: a new profile has it before its first
start, a change to an existing one applies at the next restart of Hermes.

## Home channel

`POST /_twake/v1/bots/me/home` — `{ "room_id": "!dm:example.com" }`, same
authorization. The client sends the direct room of the user with the bot as
soon as it opens it: ToM writes `MATRIX_HOME_ROOM` in the profile, where
Hermes delivers what the bot does on its own (cron jobs), as `/sethome` would.
Until then the profile holds the owner's id, so that Hermes never asks the
user to type `/sethome`. `204`; `400` for something that is not a room id;
`404` when the user has no assistant yet.

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
