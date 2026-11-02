# Production address book patch

`tom.linagora.com` runs `tom-server:v2026-07-30-node24.22.1`, built from tag `v2026-07-30` of the archived `linagora/ToM-Server-archive`. This image is that one with only `packages/tom-server/dist` replaced.

To rebuild:

1. Check out that tag and apply `prod-addressbook.patch`.
2. `docker build -f apps/tom-server/Dockerfile --target builder .` and copy `/usr/src/app/packages/tom-server/dist` next to this `Dockerfile`.
3. Build this `Dockerfile`. Published as `tom-server:v2026-07-30-node24.22.1-addressbook1`.

The same changes are in linagora/ToM-Server#122 for `main`. Drop this image once production moves to `main`.
