# Configuration

ToM Server is configured through a YAML file (`.tomconfig.yaml` or
`.tomconfig.yml`). A full annotated example is provided at
[`.tomconfig.example.yaml`](../.tomconfig.example.yaml).

Copy the example to the project root and edit it:

```bash
cp .tomconfig.example.yaml .tomconfig.yaml
```

Required fields are marked **[REQUIRED]** and use `<PLACEHOLDER>` values.
Optional fields are commented out with their defaults shown.

---

## Table of Contents

- [Server](#server)
- [URLs](#urls)
- [Synapse](#synapse)
- [ToM Database](#tom-database)
- [Hash Lookups](#hash-lookups)
- [Invitations](#invitations)
- [Terms of Service](#terms-of-service)
- [Email (SMTP)](#email-smtp)
- [LDAP](#ldap)
- [Cache](#cache)
- [SMS](#sms)
- [Federation](#federation)
- [Jitsi](#jitsi)
- [OIDC](#oidc)
- [Twake Chat](#twake-chat)
- [Features](#features)
- [Logging](#logging)
- [Internationalisation](#internationalisation)
- [Landing Page](#landing-page)
- [Matrix Client Discovery (Well-Known)](#matrix-client-discovery-well-known)
- [Matrix Authentication](#matrix-authentication)
- [Visio](#visio)
- [GIFs](#gifs)
- [Public pages](#public-pages)
- [Telemetry (OpenTelemetry)](#telemetry-opentelemetry)

---

## Server

Top-level `server` block.

```yaml
server:
  name: "<YOUR_MATRIX_DOMAIN>"
```

| Field                    Required    Default      Description                                                                              |
| -----------------------  ----------  -----------  ---------------------------------------------------------------------------------------- |
| `name`                   **Yes**         —            Matrix domain used in MXIDs (`@user:example.com`).                                       |
| `base_url`               No          `""`         Public-facing URL of this identity server. Used in email templates and invitation links. |
| `host`                   No          `"0.0.0.0"`  Bind address for the HTTP server.                                                        |
| `port`                   No          `3000`       Listen port.                                                                             |
| `trust_x_forwarded_for`  No          `false`      Enable when behind a reverse proxy.                                                      |
| `trusted_proxies`        No          `[]`         List of trusted proxy IPs.                                                               |
| `additional_features`    No          `false`      Enable extra company features.                                                           |
| `enable_cron_jobs`       No          `false`      Master switch for all scheduled background jobs.                                         |

### Rate Limiting

```yaml
server:
  rate_limiting:
    window_ms: 60000
    max_requests: 100
```

| Field           Default    Description                                   |
| --------------  ---------  --------------------------------------------- |
| `window_ms`     `60000`    Rate-limit window in milliseconds (1 minute). |
| `max_requests`  `100`      Maximum requests per window.                  |

---

## URLs

External endpoints referenced in emails, QR codes, and redirects. All optional,
all default to `""`.

```yaml
urls:
  signup: ""
  chat: ""
  auth: ""
  qr_code: ""
  invitation_redirect: ""
```

| Field                  Default    Description                                    |
| ---------------------  ---------  ---------------------------------------------- |
| `signup`               `""`       URL for the signup page.                       |
| `chat`                 `""`       URL for the chat application.                  |
| `auth`                 `""`       URL for the authentication page.               |
| `qr_code`              `""`       URL used in QR codes.                          |
| `invitation_redirect`  `""`       Redirect target after accepting an invitation. |

---

## Synapse

Homeserver integration. This block configures the connection to your Matrix
Synapse homeserver.

```yaml
synapse:
  server_url: "<https://matrix.example.com>"
  internal_host: "http://localhost:8008"
```

| Field            Required    Default                    Description                               |
| ---------------  ----------  -------------------------  ----------------------------------------- |
| `server_url`     **Yes**         —                          Public URL of the homeserver.             |
| `internal_host`  No          `"http://localhost:8008"`  Internal URL for Synapse admin API calls. |

### Admin Credentials

```yaml
synapse:
  admin:
    login: "<ADMIN_USER>"
    password: "<ADMIN_PASSWORD>"
    access_token: ""
```

| Field           Required    Default    Description                                              |
| --------------  ----------  ---------  -------------------------------------------------------- |
| `login`         **Yes**         —          Synapse admin username.                                  |
| `password`      **Yes**         —          Synapse admin password.                                  |
| `access_token`  No          `""`       Set if using token-based auth instead of login/password. |

### Synapse Database

Direct read access to the Synapse PostgreSQL database.

```yaml
synapse:
  database:
    host: "<SYNAPSE_DB_HOST>"
    name: "<SYNAPSE_DB_NAME>"
    user: "<SYNAPSE_DB_USER>"
    password: "<SYNAPSE_DB_PASSWORD>"
    ssl: false
    vacuum_delay: 3600
```

| Field           Required    Default    Description                             |
| --------------  ----------  ---------  --------------------------------------- |
| `host`          **Yes**         —          Database hostname.                      |
| `name`          **Yes**         —          Database name.                          |
| `user`          **Yes**         —          Database user.                          |
| `password`      **Yes**         —          Database password.                      |
| `ssl`           No          `false`    Enable SSL for the database connection. |
| `vacuum_delay`  No          `3600`     Seconds between vacuum operations.      |

---

## ToM Database

ToM Server's own database connection.

```yaml
database:
  host: "<TOM_DB_HOST>"
  name: "<TOM_DB_NAME>"
  user: "<TOM_DB_USER>"
  password: "<TOM_DB_PASSWORD>"
  ssl: false
  vacuum_delay: 3600
```

| Field           Required    Default    Description                             |
| --------------  ----------  ---------  --------------------------------------- |
| `host`          **Yes**         —          Database hostname.                      |
| `name`          **Yes**         —          Database name.                          |
| `user`          **Yes**         —          Database user.                          |
| `password`      **Yes**         —          Database password.                      |
| `ssl`           No          `false`    Enable SSL for the database connection. |
| `vacuum_delay`  No          `3600`     Seconds between vacuum operations.      |

---

## Hash Lookups

3PID-to-MXID pepper management. Controls the key rotation policy for privacy
preserving hash lookups.

```yaml
hash:
  rate_limit: 100
  key_delay: 3600
  keys_depth: 5
  pepper_cron: "0 0 * * *"
```

| Field          Default        Description                                                                      |
| -------------  -------------  -------------------------------------------------------------------------------- |
| `rate_limit`   `100`          Max hash lookup requests per rate window.                                        |
| `key_delay`    `3600`         Seconds before a new pepper key activates.                                       |
| `keys_depth`   `5`            Number of old pepper keys to retain.                                             |
| `pepper_cron`  `"0 0 * * *"`  Cron schedule for pepper key rotation. Requires `server.enable_cron_jobs: true`. |

---

## Invitations

```yaml
invitations:
  server_name: "matrix.to"
```

| Field          Default        Description                           |
| -------------  -------------  ------------------------------------- |
| `server_name`  `"matrix.to"`  Server name used in invitation links. |

---

## Terms of Service

Define policies per the Matrix specification. If omitted, no terms are served.

```yaml
terms:
  policies:
    privacy_policy:
      version: "1.0"
      en:
        name: "Privacy Policy"
        url: "https://example.com/privacy"
```

Each policy has a `version` and language-keyed entries (`en`, `fr`, etc.) with
`name` and `url`.

---

## Email (SMTP)

Required if sending verification emails or invitations.

```yaml
email:
  smtp_host: "<SMTP_HOST>"
  smtp_port: 587
  tls: true
  username: ""
  password: ""
  sender: ""
  sender_localpart: "twake"
  verify_certificate: true
  templates_dir: ""
  link_expiry: 3600
```

| Field                 Required    Default    Description                                                          |
| --------------------  ----------  ---------  -------------------------------------------------------------------- |
| `smtp_host`           **Yes**         —          SMTP server hostname.                                                |
| `smtp_port`           No          `587`      SMTP port.                                                           |
| `tls`                 No          `true`     Use TLS for the SMTP connection.                                     |
| `username`            No          `""`       SMTP username. Omit for unauthenticated SMTP.                        |
| `password`            No          `""`       SMTP password.                                                       |
| `sender`              No          `""`       From address for outgoing emails.                                    |
| `sender_localpart`    No          `"twake"`  Local part of the sender address.                                    |
| `verify_certificate`  No          `true`     Verify the SMTP server's TLS certificate.                            |
| `templates_dir`       No          `""`       Path to email templates. Resolved from platform share dirs if empty. |
| `link_expiry`         No          `3600`     Seconds before verification links expire.                            |

---

## LDAP

Optional directory integration. Entire section defaults to disabled.

```yaml
ldap:
  uri: "ldap://localhost:389"
  base: "dc=example,dc=com"
  user: ""
  password: ""
  filter: ""
  uid_field: "uid"
  sync_cron: "*/10 * * * *"
  client_options: {}
```

| Field             Default                   Description                                                            |
| ----------------  ------------------------  ---------------------------------------------------------------------- |
| `uri`             `"ldap://localhost:389"`  LDAP server URI.                                                       |
| `base`            `"dc=example,dc=com"`     Base DN for searches.                                                  |
| `user`            `""`                      Bind DN.                                                               |
| `password`        `""`                      Bind password.                                                         |
| `filter`          `""`                      LDAP search filter.                                                    |
| `uid_field`       `"uid"`                   Attribute used as the user identifier.                                 |
| `sync_cron`       `"*/10 * * * *"`          Cron schedule for LDAP sync. Requires `server.enable_cron_jobs: true`. |
| `client_options`  `{}`                      Raw `ldapts` client options.                                           |

---

## Cache

Defaults to in-memory caching.

```yaml
cache:
  engine: "memory"
  ttl: 3600
  redis_uri: "redis://localhost:6379"
```

| Field        Default                     Description                                                |
| -----------  --------------------------  ---------------------------------------------------------- |
| `engine`     `"memory"`                  Cache backend: `"memory"` or `"redis"`.                    |
| `ttl`        `3600`                      Cache entry lifetime in seconds.                           |
| `redis_uri`  `"redis://localhost:6379"`  Redis connection URI. **Required** when `engine` is `"redis"`. |

---

## SMS

Required only if using phone-based 3PID verification.

```yaml
sms:
  api_url: "https://api.octopush.com/v1/public"
  api_login: ""
  api_key: ""
```

| Field        Default                                 Description                |
| -----------  --------------------------------------  -------------------------- |
| `api_url`    `"https://api.octopush.com/v1/public"`  SMS provider API endpoint. |
| `api_login`  `""`                                    API login/username.        |
| `api_key`    `""`                                    API key.                   |

---

## Federation

Disabled by default. Set `is_federated_identity_service: true` to enable
federation mode.

```yaml
federation:
  is_federated_identity_service: false
  trusted_servers_addresses: []
  identity_services: []
  sync_cron: "*/10 * * * *"
```

| Field                            Default           Description                                                                  |
| -------------------------------  ----------------  ---------------------------------------------------------------------------- |
| `is_federated_identity_service`  `false`           Enable federation mode.                                                      |
| `trusted_servers_addresses`      `[]`              IP allowlist for trusted Matrix servers.                                     |
| `identity_services`              `[]`              List of peer identity services.                                              |
| `sync_cron`                      `"*/10 * * * *"`  Cron schedule for federation sync. Requires `server.enable_cron_jobs: true`. |

See also: [Federation](./Federation.md) for operational details.

---

## Jitsi

Optional video conferencing integration. Disabled by default.

```yaml
jitsi:
  base_url: ""
  use_jwt: false
  jwt_secret: ""
  jwt_issuer: ""
  jwt_algorithm: "HS256"
  preferred_domain: ""
```

| Field               Default    Description                             |
| ------------------  ---------  --------------------------------------- |
| `base_url`          `""`       Jitsi server base URL.                  |
| `use_jwt`           `false`    Enable JWT authentication.              |
| `jwt_secret`        `""`       JWT signing secret.                     |
| `jwt_issuer`        `""`       JWT issuer claim.                       |
| `jwt_algorithm`     `"HS256"`  JWT signing algorithm.                  |
| `preferred_domain`  `""`       Preferred Jitsi domain for conferences. |

---

## OIDC

Optional OpenID Connect integration.

```yaml
oidc:
  issuer: "https://sso.example.com"
```

| Field     Default                      Description      |
| --------  ---------------------------  ---------------- |
| `issuer`  `"https://sso.example.com"`  OIDC issuer URL. |

---

## Twake Chat

Client-facing environment configuration for the Twake Chat web application.
All fields have sensible defaults.

```yaml
twake_chat:
  application_name: "Twake Chat"
  application_welcome_message: ""
  privacy_url: ""
  render_html: true
  hide_redacted_events: false
  hide_unknown_events: true
  issue_id: ""
  registration_url: ""
  twake_workplace_homeserver: ""
  app_grid_dashboard_available: false
  platform: ""
  default_max_upload_avatar_size_in_bytes: ""
  dev_mode: false
  qr_code_download_url: ""
  enable_logs: false
  support_url: ""
  enable_invitations: false
```

| Field                                      Default         Description                                         |
| -----------------------------------------  --------------  --------------------------------------------------- |
| `application_name`                         `"Twake Chat"`  Display name of the application.                    |
| `application_welcome_message`              `""`            Welcome message shown to new users.                 |
| `privacy_url`                              `""`            Link to the privacy policy.                         |
| `render_html`                              `true`          Render HTML content in messages.                    |
| `hide_redacted_events`                     `false`         Hide events that have been redacted.                |
| `hide_unknown_events`                      `true`          Hide events with unknown types.                     |
| `issue_id`                                 `""`            Issue tracker identifier.                           |
| `registration_url`                         `""`            URL for the registration page.                      |
| `twake_workplace_homeserver`               `""`            Homeserver URL for Twake Workplace.                 |
| `app_grid_dashboard_available`             `false`         Show the app grid dashboard.                        |
| `platform`                                 `""`            Platform identifier.                                |
| `default_max_upload_avatar_size_in_bytes`  `""`            Max avatar upload size in bytes. No limit if empty. |
| `dev_mode`                                 `false`         Enable client development mode.                     |
| `qr_code_download_url`                     `""`            URL for QR code downloads.                          |
| `enable_logs`                              `false`         Enable client-side logging.                         |
| `support_url`                              `""`            Link to the support page.                           |
| `enable_invitations`                       `false`         Enable the invitations feature in the client.       |

---

## Features

Optional feature toggles. All disabled by default.

### Common Settings

```yaml
features:
  common_settings:
    enabled: false
    application_url: ""
```

| Field              Default    Description                       |
| -----------------  ---------  --------------------------------- |
| `enabled`          `false`    Enable the common settings panel. |
| `application_url`  `""`       URL for the settings application. |

### Matrix Profile Updates

```yaml
features:
  matrix_profile_updates_allowed: true
```

| Field                             Default    Description                   |
| --------------------------------  ---------  ----------------------------- |
| `matrix_profile_updates_allowed`  `true`     Allow Matrix profile updates. |

### User Profile

```yaml
features:
  user_profile:
    default_visibility_settings:
      visibility: "private"
      visible_fields: []
```

| Field             Default      Description                                             |
| ----------------  -----------  ------------------------------------------------------- |
| `visibility`      `"private"`  Default profile visibility (`"private"` or `"public"`). |
| `visible_fields`  `[]`         List of fields visible by default.                      |

### User Directory

```yaml
features:
  user_directory:
    enabled: false
```

| Field      Default    Description                |
| ---------  ---------  -------------------------- |
| `enabled`  `false`    Enable the user directory. |

### Create Room Proxy

```yaml
features:
  createroom_proxy:
    enabled: false
    on_failure:
      max_retries: 3
      nuke_room: true
    default_preset: "private_chat"
    encryption: "allowed"
    presets: []
```

| Field                     Default           Description                                                  |
| ------------------------  ----------------  ------------------------------------------------------------ |
| `enabled`                 `false`           Enable the room creation proxy.                              |
| `on_failure.max_retries`  `3`               Maximum retry attempts on failure.                           |
| `on_failure.nuke_room`    `true`            Delete the room on failure.                                  |
| `default_preset`          `"private_chat"`  Default room preset.                                         |
| `encryption`              `"allowed"`       Encryption mode: `"allowed"`, `"enforced"`, or `"disabled"`. |
| `presets`                 `[]`              Custom room presets.                                         |

---

## Logging

```yaml
logger:
  level: "info"
  pretty: false
```

| Field     Default    Description                                           |
| --------  ---------  ----------------------------------------------------- |
| `level`   `"info"`   Log level (`"debug"`, `"info"`, `"warn"`, `"error"`). |
| `pretty`  `false`    Pretty-print logs. Enable for local development only. |

---

## Internationalisation

```yaml
i18n:
  locale: "en"
  locales_path: "/usr/share/twake/chat/tom/i18n"
```

| Field           Default                             Description           |
| --------------  ----------------------------------  --------------------- |
| `locale`        `"en"`                              Default locale.       |
| `locales_path`  `"/usr/share/twake/chat/tom/i18n"`  Path to locale files. |

---

## Landing Page

Optional. If the file doesn't exist, the landing page route is not mounted.

```yaml
landing:
  file_path: "/usr/share/twake/chat/tom/landing.html"
```

| Field        Default                                     Description                         |
| -----------  ------------------------------------------  ----------------------------------- |
| `file_path`  `"/usr/share/twake/chat/tom/landing.html"`  Path to the landing page HTML file. |

---

## Matrix Client Discovery (Well-Known)

Disabled by default. Serves a `.well-known/matrix/client` endpoint for client
auto-discovery.

```yaml
well_known:
  client:
    enabled: true
    extra: {}
```

| Field      Default    Description                                                                                                                                                                                                                                                |
| ---------  ---------  ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`  `false`    Enable the well-known client endpoint.                                                                                                                                                                                                                     |
| `extra`    `{}`       Extra entries shallow-merged into the document. Configured keys override these: `m.homeserver` (from `synapse.server_url`), `m.identity_server` (from `server.base_url`), `t.server` (from `server`), `m.federated_identity_services` (from `federation`). |

---

## Matrix Authentication

Used by the routes authenticated with the user's Matrix access token
(`Authorization: Bearer <token>`). The token is validated against
`synapse.server_url` (`/account/whoami`) and only users of `server.name` are
accepted.

```yaml
auth:
  token_cache_size: 1000
  token_cache_ttl_ms: 60000
  timeout_ms: 10000
```

| Field                 Default  Description                                                 |
| --------------------  -------  ----------------------------------------------------------- |
| `token_cache_size`    `1000`   Maximum number of validated tokens kept in memory.          |
| `token_cache_ttl_ms`  `60000`  How long a validated token is trusted, in milliseconds.     |
| `timeout_ms`          `10000`  Timeout of each request to the homeserver, in milliseconds. |

---

## Visio

Disabled by default. Lets Twake Chat create video call rooms on the video
conferencing service (currently [La Suite Meet](https://github.com/suitenumerique/meet))
through its external API, on behalf of the authenticated user.

```yaml
visio:
  enabled: true
  base_url: "https://visio.example.com"
  client_id: "<VISIO_APPLICATION_CLIENT_ID>"
  client_secret: "<VISIO_APPLICATION_CLIENT_SECRET>"
  room_access_level: "trusted"
  timeout_ms: 10000
```

| Field                Default  Description                                                                                                            |
| -------------------  -------  ---------------------------------------------------------------------------------------------------------------------- |
| `enabled`            `false`  Enable video call room creation.                                                                                       |
| `base_url`           —        Base URL of the service. Required when enabled.                                                                        |
| `client_id`          —        Client ID of the service Application. Required when enabled.                                                           |
| `client_secret`      —        Client secret of the service Application. Required when enabled.                                                       |
| `room_access_level`  —        `"public"`, `"trusted"` or `"restricted"`. When unset, the service applies its default. Ignored by Meet before 1.17.0. |
| `timeout_ms`         `10000`  Timeout of each request to the service, in milliseconds.                                                               |

The route authenticates the user as described in
[Matrix Authentication](#matrix-authentication) and reads the user's email
from the homeserver (`/account/3pid`): Synapse must store exactly one email
for each user, e.g. through the `email_template` of its OIDC user mapping.

Two more fields serve the calls of Twake Chat (see [LiveKit](#livekit)):

| Field                   | Default                                                                                                        | Description                                                                                           |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `service_account_email` | —                                                                                                              | The account that owns the rooms made for the Matrix rooms. Required for Meet to mint the call tokens. |
| `room_configuration`    | `{screen_recording_permission: authenticated, transcript_permission: authenticated, everyone_can_mute: false}` | The configuration of those rooms (`admin_owner` restricts to the owner of the room).                  |

## LiveKit

Disabled by default. Serves the MatrixRTC token service (MSC4195) of the calls
of Twake Chat: `POST /_twake/v1/video_call/sfu/get`. The homeserver names it
in its well-known as `org.matrix.msc4143.rtc_foci[].livekit_service_url`
(`https://tom.example.com/_twake/v1/video_call`, the client appends
`/sfu/get`).

```yaml
livekit:
  enabled: true
  url: "wss://livekit.example.com"
  api_key: "devkey"
  api_secret: "<LIVEKIT_API_SECRET>"
  token_ttl_seconds: 21600
```

| Field               | Default | Description                                                                 |
| ------------------- | ------- | --------------------------------------------------------------------------- |
| `enabled`           | `false` | Enable the token service.                                                   |
| `url`               | —       | The LiveKit server as the browsers reach it. Required when enabled.         |
| `api_key`           | —       | The key LiveKit, Meet and ToM share. Required when enabled.                 |
| `api_secret`        | —       | Its secret. Required when enabled.                                          |
| `token_ttl_seconds` | `21600` | Lifetime of a token ToM signs itself; LiveKit refreshes it while connected. |

The request carries the OpenID token of the user (`openid_token`), the room
and the device, as MSC4195 says: no Matrix access token. The service checks
the token on the homeserver (`/_matrix/federation/v1/openid/userinfo`, only
users of `server.name`), that the user is a member of the room (admin API),
then answers `{"url", "jwt"}`. The LiveKit identity is always
`{user id}:{device id}`, the one MatrixRTC clients derive for the media keys.

With `visio` enabled, the room of a Matrix room is made once on Meet (owner:
`service_account_email`, `room_access_level`, `room_configuration`) and Meet
mints the token for the user (`POST
/external-api/v1.0/rooms/{id}/livekit-token/`, a route of the Linagora fork),
so that its recording, transcription and moderation know the participant.
Without `visio`, or when Meet fails, ToM signs the token itself for the Meet
room already made, or for a LiveKit room named after the Matrix room.

| Status | Meaning                                                              |
| ------ | -------------------------------------------------------------------- |
| `200`  | `{"url": "wss://…", "jwt": "…"}`                                     |
| `400`  | The body is not an MSC4195 request.                                  |
| `401`  | The homeserver rejected the OpenID token.                            |
| `403`  | The token is for another homeserver, or the user is not in the room. |
| `404`  | The service is disabled.                                             |
| `502`  | The homeserver is unreachable or failing.                            |

### Route

`POST /_twake/v1/video_call/rooms`, authenticated with the user's Matrix
access token (`Authorization: Bearer <token>`). The request body is ignored.

| Status  Meaning                                                                                                                                                           |
| ------  ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `201`   Room created: `{"url": "https://visio.example.com/abc-defg-hij"}`.                                                                                                |
| `401`   Missing or invalid Matrix access token, or user of another homeserver.                                                                                            |
| `404`   No room will be created: module disabled, or the service's token endpoint answered `404`.                                                                         |
| `422`   The user has no email or several emails on the homeserver.                                                                                                        |
| `502`   The service refused the request, or the service or the homeserver is unreachable or failing (bad credentials, domain not allowed, timeout, response without URL). |

The service's token endpoint answers `404` when its external API is disabled
or when the user is unknown to it. On `404` the client is expected to build the room
link itself.

### Service prerequisites (Meet)

- `EXTERNAL_API_ENABLED=True` and `APPLICATION_ENABLED=True`.
- `APPLICATION_JWT_SECRET_KEY` set.
- `APPLICATION_BASE_URL` equal to the `livekit_base_url` advertised to Twake
  Chat in the well-known, without trailing slash.
- An Application with the `rooms:create` scope, whose allowed domains cover
  the users' email domains.
- `EXTERNAL_API_ALLOW_PUBLIC_ACCESS=True` when `room_access_level` is
  `"public"`.
- Users already known to the service (matched by email), or it is allowed to create
  them on their first room: `APPLICATION_ALLOW_USER_CREATION=True`,
  `OIDC_FALLBACK_TO_EMAIL_FOR_IDENTIFICATION=True` and
  `OIDC_USER_SUB_FIELD_IMMUTABLE=False`. Otherwise the route answers `404` for
  them.

---

## GIFs

Off by default. Serves the GIFs of Twake Chat through ToM, so that Klipy (a
Tenor-compatible GIF API) never sees the IP address, the User-Agent or any
header of the users: ToM calls Klipy itself and streams the media from its CDN.

```yaml
gifs:
  enabled: true
  klipy_api_key: "<KLIPY_API_KEY>"
```

| Field                   | Default                  | Description                                                                                     |
| ----------------------- | ------------------------ | ----------------------------------------------------------------------------------------------- |
| `enabled`               | `false`                  | Default of the run time switch. The admin API overrides it (stored in the database of ToM).     |
| `klipy_api_key`         | `""`                     | Secret. Without it the feature is off, whatever the switch says.                                |
| `klipy_base_url`        | `https://api.klipy.com`  | The Klipy API.                                                                                  |
| `customer_id_secret`    | `""`                     | Keys the hash of the Matrix id sent as `customer_id`. The API key when unset.                   |
| `content_filter`        | `medium`                 | `off`, `low`, `medium` or `high`.                                                               |
| `timeout_ms`            | `15000`                  | Timeout of each request to Klipy and to its CDN.                                                |
| `max_media_bytes`       | `15728640`               | A GIF above this size is refused.                                                               |
| `trending_cache_ttl_ms` | `300000`                 | How long a page of trending GIFs stays in memory.                                               |

Endpoints (errors are Matrix errors, `{"errcode", "error"}`):

| Route                                           | Auth                                   | Answer                                                       |
| ----------------------------------------------- | -------------------------------------- | ------------------------------------------------------------ |
| `GET /_twake/v1/gifs/status`                    | Matrix access token                    | `{"enabled": boolean}`: key present and switch on.           |
| `GET /_twake/v1/gifs/search?q=&page=&locale=`   | Matrix access token                    | `{"results": [Gif], "next_page": number or null}`.           |
| `GET /_twake/v1/gifs/trending?page=&locale=`    | Matrix access token                    | The same.                                                    |
| `GET /_twake/v1/gifs/media/:id/:variant`        | Signed URL (`exp`, `sig`)              | The file. `variant` is `preview` or `full`.                  |
| `GET /_twake/v1/admin/features/gifs`            | `synapse.admin.access_token` as Bearer | `{"enabled": boolean, "available": boolean}`.                |
| `PUT /_twake/v1/admin/features/gifs`            | The same                               | Body `{"enabled": boolean}`, answers as the GET.             |

A `Gif` is `{"id", "title", "preview_url", "url", "width", "height"}`. Both
URLs point at the media route of ToM, signed for one hour: an `<img>` loads
them without a header. `q` is required (100 characters at most), `page` starts
at 1, `locale` is `fr`, `fr-FR`... (a country code for Klipy). Search and
trending are limited per user (`server.rate_limiting`, 429 `M_LIMIT_EXCEEDED`).
When the feature is off or has no key, `search`, `trending`, `media` and the
admin routes answer 404 `M_NOT_FOUND`, and `status` answers
`{"enabled": false}`. The admin routes are closed while
`synapse.admin.access_token` is empty.

The state is not in the well-known: the document is built once at start, and
the switch changes at run time. Clients call `status` after the sign-in.

---

## Public pages

Off by default. Serves a read-only, server-rendered HTML page (Open Graph tags,
JSON-LD `ProfilePage`, canonical URL) for each Matrix room anyone may read,
for people with no account. Needs `synapse.admin` (a token, or a login).

```yaml
public_pages:
  enabled: true
  public_url: "https://chat.example.com"
  chat_url: "https://chat.example.com"
```

| Field        | Default | Description                                                                |
| ------------ | ------- | -------------------------------------------------------------------------- |
| `enabled`    | `false` | Disabled: the routes are not mounted (404).                                |
| `public_url` | `""`    | **Required when enabled.** Origin of the pages: canonical, OG and sitemap. |
| `chat_url`   | `""`    | Target of the « Follow in Twake Chat » link. No link when empty.           |
| `lang`       | `en`    | `lang` attribute of the pages.                                             |

A room is served only if its `m.room.history_visibility` is `world_readable`
or its `m.room.join_rules` is `public` (anyone may join and read it), it has no `m.room.encryption` state and it is not a space. This gate runs on the
state of the room before any message or media is read, for pages, media and the
sitemap alike (ToM reads Synapse as admin, so it reads every room).

| Route                                  | Answer                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| `GET /b/<ref>`                         | The page. `<ref>` is a slug (alias `#slug:<server.name>`) or a URL-encoded room id. |
| `GET /b/<ref>/media/<server>/<id>`     | A media the page shows (images, audio, video only), sandboxed.                  |
| `POST /b/<ref>/react`                  | A visitor's emoji reaction (form: `event_id`, `key` among 👍 ❤️ 😂 😮 😢 🎉); pressing again removes it. `303` back to `#post-<id>`. |
| `POST /b/<ref>/report`                 | Reports a post to the Synapse moderators (form: `event_id`, `reason`, `comment`). `303` to `?reported=1#post-<id>`. |
| `GET /_twake/v1/public-pages/reactions` | `?room_id=…&event_id=…` (repeat, max 100): `{"reactions": {"<event_id>": {"👍": 3}}}`, visitor counts only. No auth, `Access-Control-Allow-Origin: *`; `404` for a room that fails the gate. |
| `GET /sitemap.xml`                     | The served rooms (the first 500 of the Synapse admin list).                     |
| `GET /robots.txt`                      | Allows `/b/`, names the sitemap.                                                |

Visitors have no account and the page runs no script: reactions and reports are
plain forms (the CSP is `form-action 'self'`). A visitor is a random id in the
cookie `tom_visitor` (HttpOnly, SameSite=Lax, path `/b/`, 1 year, Secure when
`public_url` is https). Reactions live in the table `public_reactions` of the ToM
database (unique per room, event, key, visitor) and are shown added to the
members' Matrix reactions. A POST must name a post shown on the page of a room
that passes the gate. Limits per IP: 30 POSTs a minute, 5 reports per 10 minutes.
A report goes to Synapse (`POST /_matrix/client/v3/rooms/{roomId}/report/{eventId}`,
as the admin) with the reason and comment only, never the IP or the cookie. The
texts of these controls, and of the page, follow `lang` (English, French). A room
with no avatar shows its initials.

A page is the latest 30 posts of the main timeline (edits applied, thread
replies left out), cached for 60 s. Text is escaped; `formatted_body` is never
used. Unknown or refused rooms answer `404`; a homeserver failure `502`.

---

## Telemetry (OpenTelemetry)

Disabled by default.

```yaml
telemetry:
  enabled: false
  metrics_endpoint: "/metrics"
  otlp_endpoint: ""
  trace_sample_ratio: 1.0
  diag_log_level: "NONE"
```

| Field                 Default       Description                                          |
| --------------------  ------------  ---------------------------------------------------- |
| `enabled`             `false`       Enable OpenTelemetry instrumentation.                |
| `metrics_endpoint`    `"/metrics"`  HTTP path for Prometheus-style metrics scraping.     |
| `otlp_endpoint`       `""`          OTLP collector endpoint for push-based export.       |
| `trace_sample_ratio`  `1.0`         Fraction of traces to sample when enabled (0.0–1.0). |
| `diag_log_level`      `"NONE"`      OpenTelemetry diagnostic log level.                  |

<!-- vim: set ft=markdown fenc=utf-8 spell spl=en tw=80 cc=80 et ts=2: -->
