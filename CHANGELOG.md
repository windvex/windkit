# Changelog

All notable changes to this project are documented in this file.

This project follows [Semantic Versioning](https://semver.org/).

---

## [0.2.3] - 2026-03-02

Published: 2026-03-02T14:07:04Z

### Changed

- Session storage key standardized to `"vex-session"`.
- Login identity payload compacted with standardized keys:
  - `pi` (peer id)
  - `na` (app name)
  - `ic` (icon)
  - `do` (origin)
  - optional `auth` (cached identity proof)
- RPC method names standardized:
  - `signRequest`
  - `signMessage`
  - `sharedSecret`

### Added

- `clearSession()` helper for manual session reset.
- Smart session reuse:
  - Reuses stored `peerID`
  - Reuses permission hints (`account@permission`) when available.

### Fixed

- Hardened session loader:
  - Automatically clears expired or malformed session payloads.
- Improved disconnect cleanup:
  - Safe destroy/disconnect (best-effort, non-throwing).

### Improved

- Optimized for low-memory environments:
  - Lightweight heartbeat with jitter
  - Reduced message routing allocations
  - Lower background CPU usage on mobile devices

---

## [0.2.1] - 2025-10-13

Published: 2025-10-13T16:28:38Z

### Added

- PeerJS signaling support.
- Session persistence via `sessionStorage`.
- Transaction signing via Vexanium Signing Request (VSR).
- Message signing support.
- Shared secret derivation (ECDH).

---

## [0.2.0] - 2025-10-06

Published: 2025-10-06T14:44:23Z

### Added

- Structured WebRTC connection lifecycle.
- WalletSession abstraction layer.
- Basic login flow via embedded PeerID inside VSR.
- Request/response routing via internal request IDs.

### Improved

- More predictable session initialization flow.
- Internal protocol normalization groundwork.

---

## [0.1.1] - 2025-08-12

Published: 2025-08-12T01:33:25Z

### Added

- Initial public release of WindKit.
- Basic VSR identity login.
- WebRTC DataConnection integration.
- Minimal transaction signing flow.