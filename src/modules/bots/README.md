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
| --- | --- |
| `200 { userId, deviceId, masterKey }` | The bot exists and has published its keys. Idempotent. |
| `503 M_SERVICE_UNAVAILABLE` | The bot was just provisioned, Hermes has not published its keys yet: call again in a moment. |
| `502 M_BAD_GATEWAY` | The homeserver refused or could not be reached. |
| `404 M_NOT_FOUND` | `bots.enabled` is false: the client hides the action. |
| `401 M_UNAUTHORIZED` | No valid token. |

`masterKey` is the public master cross-signing key of the bot, the value in
`master_keys[<bot>].keys` of `/keys/query`; the client compares it with what
the homeserver publishes before marking the device verified.

`GET /_twake/v1/bots/me`, with the same authorization and no body, reads the
bot of the user and never makes one, so that the client learns whether the
user has an assistant without giving them one. With Hermes, the bot exists
once its profile is written (see What a first call does); with the harness,
once the harness has it.

| Answer | When |
| --- | --- |
| `200 { userId, deviceId, masterKey }` | The bot exists and has published its keys: the body of the POST. |
| `404 M_BOT_NOT_FOUND` | The user has no assistant, or deleted theirs: the client may offer to make one. |
| `503 M_SERVICE_UNAVAILABLE` | The bot exists but its keys are not published yet: call again in a moment. |
| `422 M_BOT_RECOVERY_NEEDED` | The bot waits for its owner to recover its identity (harness backend). |
| `422 M_UNPROCESSABLE` | The harness does not serve the homeserver of the user. |
| `502 M_BAD_GATEWAY` | The homeserver or the harness refused or could not be reached. |
| `404 M_NOT_FOUND` | `bots.enabled` is false, as for the POST: the client hides the action. |
| `401 M_UNAUTHORIZED` | No valid token. |

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
`404` when the user has no assistant yet. The route answers once the backend
has recorded the room, so a backend that records it remotely answers `204`
only when it has it, and its refusals reach the client.

## Suggestions

`GET /_twake/v1/bots/me/suggestions` answers `{ "enabled": true }` or
`false`: whether the assistants read the user's messages in channels and
offer them actions (twake-harness, Suggestions). `PUT` with
`{ "enabled": false }` turns it off, and answers the same. Same
authorization; no assistant needed, the switch is on by default. The harness
backend asks `/v1/provisioning/assistants/{owner}/suggestions`; Hermes makes
no suggestions, so the route answers `404` there, as when bots are off, and
the client hides the switch. `400` for a body without a boolean.

## Commands (MSC4332)

Hermes announces no command. Every `publish_interval_ms`, ToM writes the
state `org.matrix.msc4332.commands` (state key: the id of the bot, content:
`bots.commands`) in every room each provisioned bot is in, once per room.
Rooms created by Twake Chat let any member write it; other rooms need the
moderator, and are tried again at the next round. With the harness backend,
ToM announces nothing: the harness announces the commands of its bots
(linagora/twake-harness#74, #76).

## Backends

`bots.backend` names what serves the bots: `hermes` (the default, described
above) or `harness`, the agent harness of the platform
([linagora/twake-harness](https://github.com/linagora/twake-harness)), which
owns the bots as its Matrix application service (see Harness backend). The
routes take either backend.

**One backend per ToM.** A ToM served by the harness refuses
`hermes_profiles_dir`, and a ToM served by Hermes refuses the `harness` block:
the configuration does not load otherwise. Two runtimes on the same accounts
answer every message twice and take each other's room keys, so the owner's
messages reach the wrong device: this happened on a development platform
where Hermes and the harness both claimed the assistants of the same users.

## Harness backend

`bots.backend: harness` hands the assistants to the agent harness. The harness
owns the bots: their accounts, their devices, their encryption identity. ToM
creates no account, writes no profile and needs no Synapse admin: it asks the
harness for the bot of the user and answers the client exactly as above, so
nothing changes for Twake Chat.

ToM calls the harness with a token of its own OIDC client, from the client
credentials grant on `bots.harness.token_url`, with `bots.harness.scope`
(`openid` by default: LemonLDAP-NG refuses a client credentials request with
no scope). The client id and secret are form-encoded before the Basic header,
as RFC 6749 §2.3.1 says. The token carries the audience the harness accepts,
and the harness admits ToM's client by its subject. It is kept until shortly
before it expires, fetched once for calls that need it at the same time, and
replaced once when the harness refuses it. The user's Matrix token never
leaves ToM: ToM has checked it and names the user.

| ToM calls | The harness answers |
| --- | --- |
| `PUT <url>/v1/provisioning/assistants/<owner>` `{ "timezone": "Europe/Paris" }` | `200 { userId, deviceId, masterKey }`; `503` with `Retry-After` while it prepares the identity of the bot; `422` when the owner is not on its homeserver |
| `GET <url>/v1/provisioning/assistants/<owner>` | As the PUT, without making the bot; `404 no assistant` when the owner has none, or deleted theirs; `409 recovery_needed` while the bot waits for its owner's recovery |
| `PUT <url>/v1/provisioning/assistants/<owner>/home` `{ "roomId": "!dm:example.com" }` | `204` recorded; `404` no bot yet; `409 not a member` the bot has not joined the room yet; `409 not a direct room` someone else is in it |

`<owner>` is the Matrix id of the user, URL-encoded. The calls are
idempotent: on `503` and `409 not a member` ToM asks again, as the harness
says or every second, while `ready_timeout_ms` allows. The whole route, token,
calls and waits included, answers within `ready_timeout_ms` of its start: past
it, the client gets `503` and tries again, before its own 15 s timeout. `422`,
`409 recovery_needed` and `409 not a direct room`, which no retry fixes,
answer the client `422`. On the read, only `404 no assistant` means the user
has no bot (`404 M_BOT_NOT_FOUND`): another `404`, as from a harness without
the read, is a failure. Anything else answers `502`. ToM logs the endpoint
(`PUT /v1/provisioning/assistants/{owner}`, its `GET`, its `/home`, the token
request) and the status or the error's code, never the owner nor what the
harness answered.

The harness side of this contract is
[linagora/twake-harness#74](https://github.com/linagora/twake-harness/pull/74),
and [#105](https://github.com/linagora/twake-harness/pull/105) for the read.

## Configuration

See `.tomconfig.example.yaml`, section `bots`. `backend` is `hermes` (the
default) or `harness` (see Backends). With Hermes, `hermes_profiles_dir` is the
`profiles` directory of the Hermes home, shared with the agent (a volume).
`hermes_homeserver_url` is the homeserver as the agent reaches it, and
`hermes_home` the home of the agent as the agent sees it (the paths written in
a profile, such as the recovery key file, are for the agent). With the
harness, `harness` gives the base URL of the harness API (`url`, before its
`/v1` routes), the token endpoint (`token_url`), ToM's OIDC client
(`client_id`, `client_secret`) and the `scope` of the token request.
`ready_timeout_ms` (12 s by default) bounds every route, with either backend:
keep it below the client's 15 s.
