# Changelog

## [v2.1.0](https://github.com/linagora/tom-server/compare/v2.0.1...v2.1.0) (2026-11-12)

### Features

* **user-info:** return the common settings theme to its owner
([e2e64af](https://github.com/linagora/tom-server/commit/e2e64af072bd45835ff6738234014135b4f3793d)),
closes [#43](https://github.com/linagora/tom-server/issues/43)
* **visio:** add video call room creation
([6651bd2](https://github.com/linagora/tom-server/commit/6651bd21a75570c6f659d832afec73cbf4a77fef))

### Fixes

* **invitation:** strip CR/LF from mail template values
([403ba08](https://github.com/linagora/tom-server/commit/403ba08af59c955b74bb390844ab230823962116))
* **sms:** restrict the sms relay to local users and cap recipients
([e9e4370](https://github.com/linagora/tom-server/commit/e9e4370d1c85dc82fbc08c7b4e1883e7b91d7231))
* **crypto:** draw secret tokens from a cryptographic generator
([8057216](https://github.com/linagora/tom-server/commit/8057216d4d4c0539ae64eed873e72fc5e7f36b64))
* **createroom:** set the enforced encryption state ourselves
([95f947e](https://github.com/linagora/tom-server/commit/95f947ea546c84b95d9f3b3ac524b49bea3ded22))
* **user-info:** bind profile and directory data to the local server
([663f429](https://github.com/linagora/tom-server/commit/663f429e79d8984e8e5249848b4e6db189bab927))
* **invitation:** render invitation mail templates in one escaped pass
([a1adc21](https://github.com/linagora/tom-server/commit/a1adc21c01ed07b0d316b3e7a4ded7fd5a837f5e))
* **userdb:** escape ldap filter values per rfc 4515
([61c4fb6](https://github.com/linagora/tom-server/commit/61c4fb663f4c84cac9eae171b88525f67d88aaee))
* **auth:** re-check a cached matrix token against synapse once it is stale
([dceee6b](https://github.com/linagora/tom-server/commit/dceee6be7a00e27ab545f0061410cc61a6f8c25a))
* **db:** reject non-identifier names in the sql write sinks
([df2b78f](https://github.com/linagora/tom-server/commit/df2b78fdc6c6f3f73ba29ac5fd8d0e7b52e6b84e))
* **identity:** restrict lookup diff fields to the user columns
([31b4737](https://github.com/linagora/tom-server/commit/31b47373624495b00809f704d25600a7e211944e))
* **identity:** use a short-term ed25519 key for store-invite
([bed9cb4](https://github.com/linagora/tom-server/commit/bed9cb41891485d7d6a3c25f1c9a4446269f2f85))
* **user-info:** validate the visibility payload before storing it
([64fac37](https://github.com/linagora/tom-server/commit/64fac373b11ba2c9dbe28f2a6b4ae70b8392d58f))
* **utils:** answer 400 for a request body that is not a json object
([b489d80](https://github.com/linagora/tom-server/commit/b489d80e9ef1d9af55fa897b1eced10215a7ee68))
* **3pid:** restrict bind and unbind to the caller's own binding
([9bbb38b](https://github.com/linagora/tom-server/commit/9bbb38b95fb70fac22e37e7e0b91eb4e315a9cfe))
* **terms:** record the acceptance for the authenticated user
([2954d72](https://github.com/linagora/tom-server/commit/2954d7279aef24adc18f8e129d6f53de30dc1a4e))
* **db:** match no row for an empty or missing filter value
([cc74c1a](https://github.com/linagora/tom-server/commit/cc74c1ac81f6f44bba1d23c380bcae47fa1bd28f))
* **errors:** negotiate the locale of an error from Accept-Language
([f62bd52](https://github.com/linagora/tom-server/commit/f62bd52037a67fac6041f517695de58234964acd)),
closes [#42](https://github.com/linagora/tom-server/issues/42)
* **i18n:** fall back to english for a key missing from a locale (#44)
([7912322](https://github.com/linagora/tom-server/commit/79123220e8b1c89964281fbbfe6f4cf667c57446)),
closes [#44](https://github.com/linagora/tom-server/issues/44)
[#41](https://github.com/linagora/tom-server/issues/41)
* **identity:** bind the OpenID sub to the queried server (#34)
([1488143](https://github.com/linagora/tom-server/commit/148814325a4c9fef33b832b3d7ac0bda0df02faf)),
closes [#34](https://github.com/linagora/tom-server/issues/34)

## [v2.0.1](https://github.com/linagora/tom-server/compare/v2.0.0...e15f9e9bdf4fec5524b8a996600c15d152a3c7c3) (2026-09-15)

## [v2.0.0](https://github.com/linagora/tom-server/compare/v1.0.0...v2.0.0) (2026-09-15)

## v1.0.0 (2026-09-15)

<!-- markdownlint-disable-file MD024 -->
