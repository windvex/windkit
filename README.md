# WindKit
A protocol to connect Vexanium DApps to the Wind wallet.

## Features
- Cross-device login via VSR (Vexanium Signing Request)
- Transaction signing (single or multiple actions)
- Message signing
- Shared secret (ECDH) for encryption

## Initialize the Connector
```javascript
import { WindConnector } from "windkit";

const connector = new WindConnector();
connector.on("session", onSession); // fires after wallet approves login
await connector.connect();
```

## Create a Login Request and Open the Wallet
```javascript
// Build a VSR and deep-link / QR it to the wallet
const vsr = connector.createLoginRequest("Vexanium DApp", "https://example.com/icon.png");
const request = vsr.split(":")[1];

// Open Wind Wallet login (adjust the URL/host as needed)
const walletUrl = `https://windwallet.app/login?vsr=${request}`;
window.open(walletUrl, "Wind Wallet");
```

## Receive a WalletSession
```javascript
import { ABICache } from "@wharfkit/abicache";

const abiCache = new ABICache({/* optional custom fetch */});

function onSession(session, proof) {
  // Optional on first login: verify IdentityProof as needed
  const account = proof?.signer?.toString?.(); // e.g., "userxyz@active"

  session.setABICache(abiCache);  // faster ABI (de)serialization
  session.onClose(() => console.log("Disconnected from wallet"));
  
  // Store for later use
  Store.session = session;
}
```

## Send a Transaction
```javascript
import { Action } from "@wharfkit/antelope";

// Example: transfer VEX
const abi = await abiCache.getAbi("vex.token");
const data = {
  from: "aiueo",
  to: "babibu",
  quantity: "1.0000 VEX",
  memo: "test transfer"
};

const action = Action.from(
  {
    account: "vex.token",
    name: "transfer",
    data,
    authorization: [Store.session.permissionLevel]
  },
  abi
);

// By default, transact() broadcasts. Set { broadcast: false } to sign only.
const result = await Store.session.transact({ action });
// result is either SendTransactionResponse (broadcast) or SignedTransaction (sign-only)
console.log(result.transaction_id ?? result.id);
```

> Notes  
> - Class names: `WindConnector` (connector) and `WalletSession` (active session).  
> - Chain ID is handled internally by `WalletSession.ChainID` (Vexanium mainnet).  
> - For re-login, the `session` event may be called without `proof` (use `session.permissionLevel`).  