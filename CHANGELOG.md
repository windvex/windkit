# Changelog
All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),  
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.2.1] - 2025-10-14
### Added
- **PeerJS standalone defaults**
  - Built-in configuration compatible with Wind’s production signaling service:
    - `host=core.windcrypto.com`
    - `port=443`
    - `secure=true`
    - `path='/'`
    - `key='peerjs'`
- **Server configuration helpers**
  - `configureForCore()` – instantly configure connection for Wind’s main backend.
  - `setServer()`, `setPath()`, `setKey()`, `setSecure()`, and `setPort()` for granular overrides.
- **ICE / TURN utilities**
  - `addIceServer()`, `setIceServers()`, and `clearIceServers()` for dynamic WebRTC setups.
  - Automatic TURN validation to prevent missing credentials (`username` / `credential`).
- **Event system**
  - Re-emits PeerJS events: `open`, `close`, `disconnected`, `error`, and `session`.
- **Session persistence**
  - Automatically reuses valid sessions via `sessionStorage` (with `exp` and `sig`).

### Changed
- TypeScript refactor and dual-build system (ESM + CJS + Type definitions).
- Re-login logic now restores wallet session if still valid.
- Improved error handling and event propagation.

### Fixed
- Prevented WebRTC error: “Both username and credential are required when the URL scheme is turn/turns.”
- Cleared expired sessions from storage automatically.
- Improved decoding and validation of `IdentityProof` objects.

---

## [0.1.1] - 2025-08-12
### Added
- **Initial public release of WindKit.**
  - A protocol for connecting Vexanium DApps to the Wind wallet.
- Core features:
  - Cross-device login via VSR (Vexanium Signing Request).
  - Transaction signing (single or multiple actions).
  - Message signing.
  - Shared secret (ECDH) encryption.
  - PeerJS-based WebRTC signaling.
- Published package: [`windkit`](https://www.npmjs.com/package/windkit).

---

### 🧩 Links
- **Repository:** [https://github.com/windvex/windkit](https://github.com/windvex/windkit)
- **npm:** [https://www.npmjs.com/package/windkit](https://www.npmjs.com/package/windkit)
- **License:** [MIT](./LICENSE)
