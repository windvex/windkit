# Changelog

All notable changes to this project will be documented in this file.

This project follows Semantic Versioning.

---

## [0.2.2] - 2026-03-02

### Changed

- Session storage key standardized to `"vex-session"`.
- Login identity request now stores compact app info keys:
  - `pi` (peer id), `na` (app name), `ic` (icon), `do` (origin), optional `auth` (cached proof).
- Request method names standardized:
  - `signRequest`, `signMessage`, `sharedSecret`.

### Added

- `clearSession()` helper.
- Session reuse:
  - Reuses saved `peerID` and hints (`account@permission`) when present.

### Fixed

- Safer session loading (auto-clears invalid or expired payloads).
- Improved cleanup on disconnect (best-effort destroy/disconnect).

### Improved

- Low-memory friendly behavior:
  - Lightweight heartbeat/ping with jitter (best-effort).
  - Minimal allocations on message routing.

---

## [0.2.1]

### Added

- Initial PeerJS signaling support.
- Session persistence via sessionStorage.
- Transaction signing via VSR.
- Message signing.
- Shared secret (ECDH).

---

## [0.1.1]

### Added

- Initial public release of WindKit.
