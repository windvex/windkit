# WindKit

[![npm version](https://img.shields.io/npm/v/windkit.svg)](https://www.npmjs.com/package/windkit)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

WindKit is a lightweight WebRTC protocol for connecting Vexanium DApps to Wind Wallet using PeerJS and WharfKit Signing Requests (VSR).

It enables secure cross-device login and transaction signing without requiring browser extensions.

Designed for production environments, including low-RAM mobile devices.

---

## ✨ Features

- Cross-device login via VSR (Vexanium Signing Request)
- Transaction signing (single action, multiple actions, or full transaction)
- Optional broadcast control (sign-only or broadcast)
- Message signing
- Shared secret derivation (ECDH)
- Session persistence via `sessionStorage`
- Low-memory heartbeat strategy
- Pure ESM module (JavaScript-only)

---

## 📦 Installation

```bash
npm install windkit
```

WindKit is **ESM-only**.

Your project must include:

```json
{
  "type": "module"
}
```

---

## 🚀 Quick Start

### Create Connector

```js
import { WindConnector } from "windkit";

const connector = new WindConnector();

connector.on("session", (session, proof) => {
  console.log("Connected as:", session.permissionLevel?.toString());
});

await connector.connect();
```

By default, WindKit uses PeerJS default signaling.

---

## 🌐 Custom PeerJS Server (Optional)

```js
connector.setServer("peer.yourdomain.com", 443, "/", true);
```

Signature:

```js
setServer(host, port, path, secure);
```

Add custom ICE server:

```js
connector.addIceServer({
  urls: "stun:stun.cloudflare.com:3478"
});
```

---

## 🔐 Login Flow (VSR)

```js
const vsr = connector.createLoginRequest(
  "My Vexanium DApp",
  "https://example.com/icon.png"
);

const payload = vsr.startsWith("vsr:") ? vsr.slice(4) : vsr;

window.open(
  `https://wallet.windcrypto.com/login?vsr=${encodeURIComponent(payload)}`,
  "Wind Wallet"
);
```

Wallet flow:

1. Decode VSR  
2. Connect to embedded PeerID  
3. Send `LOGIN_OK`  
4. Emit session  

---

## 🔄 Session Handling

```js
connector.on("session", (session, proof) => {
  session.onClose(() => {
    console.log("Wallet disconnected");
  });

  session.onError((error) => {
    console.error("Session error:", error);
  });

  window.appSession = session;
});
```

---

## ✍️ Send Transaction

### With ABI Cache (Recommended)

```js
import { Action } from "@wharfkit/antelope";
import { ABICache } from "@wharfkit/abicache";

const abiCache = new ABICache();
appSession.setABICache(abiCache);

const abi = await abiCache.getAbi("vex.token");

const action = Action.from(
  {
    account: "vex.token",
    name: "transfer",
    data: {
      from: "alice",
      to: "bob",
      quantity: "1.0000 VEX",
      memo: "WindKit test"
    },
    authorization: [appSession.permissionLevel]
  },
  abi
);

const result = await appSession.transact({ action });

console.log(result.transaction_id ?? result.id);
```

---

### Sign Only (No Broadcast)

```js
await appSession.transact(
  { action },
  { broadcast: false }
);
```

---

## 📝 Sign Message

```js
const signature = await appSession.signMessage("Hello Wind!");
console.log(signature.toString());
```

---

## 🔑 Shared Secret (ECDH)

```js
import { PublicKey } from "@wharfkit/antelope";

const pub = PublicKey.from("PUB_K1_...");
const secret = await appSession.sharedSecret(pub);

console.log(secret.toString());
```

---

## 💾 Session Storage

WindKit stores session data in:

```js
sessionStorage["vex-session"]
```

Example structure:

```json
{
  "peerID": "VEX-xxxx",
  "permission": "account@active",
  "expiration": "2026-03-01T12:00:00",
  "auth": "base64u_identity_proof"
}
```

Clear session manually:

```js
import { clearSession } from "windkit";

clearSession();
```

---

## 🏗 Architecture

### WindConnector

- Creates VSR identity login
- Hosts PeerJS PeerID (DApp-side)
- Waits for wallet connection
- Emits session

### WalletSession

- Sends:
  - `signRequest`
  - `signMessage`
  - `sharedSecret`
- Routes replies via request IDs
- Lightweight heartbeat ping
- Handles account change events

---

## 🔎 Protocol Notes

Transaction signing method:

```
signRequest
```

Wallet push events handled:

```
LOGIN_OK
ACTIVE_ACCOUNT_CHANGED
```

All communication occurs over PeerJS `DataConnection`.

---

## ⚙ Technical Details

Chain ID is internally fixed via:

```js
WalletSession.ChainID
```

Dependencies:

- `@wharfkit/signing-request`
- `@wharfkit/antelope`
- `peerjs`
- `pako`

Optimized for:

- Low-RAM mobile devices
- Background browser tabs
- Unstable WebRTC networks

---

## 🔐 Security Model

- IdentityProof can be verified by the DApp (recommended).
- Private keys never leave the wallet.
- VSR ensures transaction integrity.
- PeerID is embedded inside the VSR payload to prevent misrouting.

---

## 📄 License

MIT License  
© Wind Stack