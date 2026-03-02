// windkit/WalletSession.js
// Ultra Clean++ (single replace)
// ✅ fixes peerID case bug in ACTIVE_ACCOUNT_CHANGED
// ✅ bounded ping heartbeat (jitter) for low-end
// ✅ strict request mapping + timeout cleanup
// ✅ minimal surface: transact/signRequest/signMessage/sharedSecret

import { Base64u, IdentityProof, SigningRequest } from "@wharfkit/signing-request";
import {
  Checksum512,
  Name,
  PermissionLevel,
  PublicKey,
  Serializer,
  Signature,
  SignedTransaction,
} from "@wharfkit/antelope";

import zlib from "pako";
import { loadSession, saveSession } from "./StoreSession.js";

const DEFAULT_TIMEOUT_MS = 90_000;
const PING_MS = 15_000;
const PING_JITTER_MS = 2_000;

function uuid() {
  try {
    if (globalThis?.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch {}
  return `id-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;
}

function setTimer(fn, ms) {
  try {
    return globalThis.setTimeout(fn, ms);
  } catch {
    return setTimeout(fn, ms);
  }
}

function clearTimer(id) {
  try {
    globalThis.clearTimeout(id);
  } catch {
    clearTimeout(id);
  }
}

function normalizeTimeoutMs(v, fallback = DEFAULT_TIMEOUT_MS) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1000, Math.trunc(n));
}

function errorFromReply(reply, fallback) {
  const err = reply?.error;
  if (typeof err === "string") return new Error(err);
  if (err?.message) return new Error(err.message);
  return new Error(fallback || "Request rejected.");
}

/**
 * WalletSession
 * - Wraps a PeerJS DataConnection (DApp->Wallet)
 * - Sends requests to wallet and maps replies by id
 */
export class WalletSession {
  static ChainID = "f9f432b1851b5c179d2091a96f593aaed50ec7466b74f89301f957a83e56ce1f";

  /** @type {import("peerjs").DataConnection} */
  #connection;

  /** @type {Map<string, {resolve:Function, reject:Function, timeout:any}>} */
  #pending = new Map();

  /** @type {{zlib:any, abiProvider?:any} | undefined} */
  #encodingOptions;

  /** @type {PermissionLevel | undefined} */
  #permissionLevel;

  /** @type {(permission: PermissionLevel) => void | undefined} */
  #accountChangeListener;

  /** @type {() => void | undefined} */
  #closeListener;

  /** @type {(error: Error) => void | undefined} */
  #errorListener;

  /** @type {any} */
  #pingTimer = null;

  /**
   * @param {import("peerjs").DataConnection} connection
   */
  constructor(connection) {
    this.#connection = connection;

    connection.on("data", (msg) => this.#onDataReceived(msg));

    connection.on("close", () => {
      this.#stopPing();

      for (const [id, p] of this.#pending.entries()) {
        try {
          clearTimer(p.timeout);
        } catch {}
        try {
          p.reject(new Error("Wallet connection closed."));
        } catch {}
        this.#pending.delete(id);
      }

      if (this.#closeListener) this.#closeListener();
    });

    connection.on("error", (error) => {
      if (this.#errorListener) this.#errorListener(error);
    });

    this.#startPing();
  }

  /**
   * Optional ABI cache provider (recommended when creating requests).
   * @param {import("@wharfkit/abicache").ABICache} cache
   */
  setABICache(cache) {
    this.#encodingOptions = { zlib, abiProvider: cache };
  }

  onAccountChange(listener) {
    this.#accountChangeListener = listener;
  }

  onClose(listener) {
    this.#closeListener = listener;
  }

  onError(listener) {
    this.#errorListener = listener;
  }

  isOpen() {
    return Boolean(this.#connection?.open);
  }

  close() {
    this.#stopPing();
    try {
      this.#connection.close();
    } catch {}
  }

  metadata() {
    return this.#connection.metadata;
  }

  get permissionLevel() {
    return this.#permissionLevel;
  }

  set permissionLevel(value) {
    this.#permissionLevel = value;
  }

  get actor() {
    return this.#permissionLevel?.actor ?? Name.from("");
  }

  get permission() {
    return this.#permissionLevel?.permission ?? Name.from("");
  }

  /**
   * @typedef {Object} TransactArguments
   * @property {import("@wharfkit/antelope").Action=} action
   * @property {Array<import("@wharfkit/antelope").Action>=} actions
   * @property {import("@wharfkit/antelope").Transaction=} transaction
   */

  /**
   * @typedef {Object} TransactOptions
   * @property {boolean=} broadcast True to broadcast, false for sign-only.
   * @property {number=} timeoutMs Per-request timeout (default 90s).
   */

  /**
   * Create a VSR signing request for a transaction and send to wallet.
   * @param {TransactArguments} args
   * @param {TransactOptions=} options
   * @returns {Promise<SignedTransaction|any>} SignedTransaction (sign-only) OR wallet push result (broadcast)
   */
  async transact(args, options) {
    const willBroadcast = typeof options?.broadcast === "boolean" ? options.broadcast : true;

    const requestArgs = { ...args, chainId: WalletSession.ChainID };
    const req = await SigningRequest.create(requestArgs, this.#encodingOptions);
    req.setBroadcast(willBroadcast);

    const vsr = req.encode(true, false, "vsr:");
    return this.signRequest(vsr, options?.timeoutMs);
  }

  /**
   * Send a signing request string to the wallet.
   * @param {string} vsr
   * @param {number=} timeoutMs
   * @returns {Promise<any|SignedTransaction>}
   */
  signRequest(vsr, timeoutMs) {
    return this.#request("signRequest", { vsr }, timeoutMs, (reply) => {
      if (reply?.code === "SENT") return reply.result;
      if (reply?.code === "SIGNED") return SignedTransaction.from(reply.result);
      throw errorFromReply(reply, "Signing request rejected.");
    });
  }

  /**
   * Ask wallet to sign an arbitrary message.
   * @param {string} message
   * @param {number=} timeoutMs
   * @returns {Promise<Signature>}
   */
  signMessage(message, timeoutMs) {
    return this.#request("signMessage", { message }, timeoutMs, (reply) => {
      if (reply?.code === "SIGNED") return Signature.from(reply.result.signature);
      throw errorFromReply(reply, "Message signing rejected.");
    });
  }

  /**
   * Ask wallet to derive a shared secret from a public key.
   * @param {PublicKey} publicKey
   * @param {number=} timeoutMs
   * @returns {Promise<Checksum512>}
   */
  sharedSecret(publicKey, timeoutMs) {
    return this.#request("sharedSecret", { key: publicKey.toString() }, timeoutMs, (reply) => {
      if (reply?.code === "CREATED") return Checksum512.from(reply.result.secret);
      throw errorFromReply(reply, "Shared secret creation failed.");
    });
  }

  /**
   * Internal: handle ACTIVE_ACCOUNT_CHANGED.
   * @param {string} auth
   */
  #onChangeAccount(auth) {
    const proof = Serializer.decode({ data: Base64u.decode(auth), type: IdentityProof });
    this.permissionLevel = proof.signer;

    const session = loadSession();
    if (session) {
      // ✅ FIX: property is peerID (case-sensitive)
      saveSession({
        peerID: session.peerID,
        permission: proof.signer.toString(),
        expiration: proof.expiration,
        auth,
      });
    }

    if (this.#accountChangeListener) this.#accountChangeListener(proof.signer);
  }

  #startPing() {
    if (this.#pingTimer) return;

    const loop = () => {
      if (!this.isOpen()) return;

      const jitter = Math.floor(Math.random() * PING_JITTER_MS);
      this.#pingTimer = setTimer(() => {
        this.#ping().catch(() => {});
        loop();
      }, PING_MS + jitter);
    };

    loop();
  }

  #stopPing() {
    if (this.#pingTimer != null) {
      clearTimer(this.#pingTimer);
      this.#pingTimer = null;
    }
  }

  async #ping() {
    if (!this.isOpen()) return;
    try {
      this.#connection.send({ method: "ping", id: uuid(), params: { time: Date.now() } });
    } catch {
      // best-effort only
    }
  }

  /**
   * Core request helper with timeout + reply mapping.
   * @template T
   * @param {string} method
   * @param {any} params
   * @param {number=} timeoutMs
   * @param {(reply:any)=>T} mapper
   * @returns {Promise<T>}
   */
  #request(method, params, timeoutMs, mapper) {
    if (!this.isOpen()) return Promise.reject(new Error("Wallet connection is not open."));

    const id = uuid();
    const ms = normalizeTimeoutMs(timeoutMs, DEFAULT_TIMEOUT_MS);

    return new Promise((resolve, reject) => {
      const timeout = setTimer(() => {
        this.#pending.delete(id);
        reject(new Error(`${method} timed out.`));
      }, ms);

      this.#pending.set(id, {
        timeout,
        resolve: (reply) => {
          try {
            const out = mapper(reply);
            clearTimer(timeout);
            this.#pending.delete(id);
            resolve(out);
          } catch (e) {
            clearTimer(timeout);
            this.#pending.delete(id);
            reject(e);
          }
        },
        reject: (e) => {
          clearTimer(timeout);
          this.#pending.delete(id);
          reject(e);
        },
      });

      try {
        this.#connection.send({ method, id, params });
      } catch (e) {
        clearTimer(timeout);
        this.#pending.delete(id);
        reject(e);
      }
    });
  }

  /**
   * Handle incoming messages from wallet.
   * @param {any} data
   */
  #onDataReceived(data) {
    if (!data || typeof data !== "object") return;

    // Reply to pending request
    if (data.id && this.#pending.has(data.id)) {
      const p = this.#pending.get(data.id);
      try {
        p.resolve(data);
      } catch (e) {
        p.reject(e);
      }
      return;
    }

    // Wallet push notifications
    if (data.code === "ACTIVE_ACCOUNT_CHANGED" && data?.result?.auth) {
      this.#onChangeAccount(data.result.auth);
    }
  }
}