// windkit/WindConnector.js
// Ultra Clean++ (single replace)
// ✅ PeerID embedded into VSR (infoKey "pi")
// ✅ connect() reuses stored peerID (stable pairing)
// ✅ LOGIN_OK → decode IdentityProof → yield WalletSession
// ✅ low-end friendly: minimal work, no polling loops

import { Base64u, IdentityProof, SigningRequest } from "@wharfkit/signing-request";
import { Serializer } from "@wharfkit/antelope";
import Peer from "peerjs";
import zlib from "pako";

import { WalletSession } from "./WalletSession.js";
import { loadSession, saveSession, clearSession } from "./StoreSession.js";

function uuid() {
  try {
    if (globalThis?.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch {}
  return `id-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;
}

function originSafe() {
  try {
    return globalThis?.location?.origin || "";
  } catch {
    return "";
  }
}

function defaultPeerConfig() {
  return {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:3478" },
      { urls: "stun:stun.relay.metered.ca:80" },
      {
        urls: "turn:asia.relay.metered.ca:80",
        username: "b66cd40a117bddb5cde924ab",
        credential: "4jRmuTehVCZ2a/S+",
      },
    ],
    sdpSemantics: "unified-plan",
  };
}

function mergePeerOptions(userOptions) {
  const opts = userOptions ? { ...userOptions } : {};
  const base = defaultPeerConfig();

  // Keep base config but allow user overrides
  if (!opts.config) {
    opts.config = base;
    return opts;
  }

  const userCfg = { ...opts.config };
  const userIce = Array.isArray(userCfg.iceServers) ? userCfg.iceServers : null;

  opts.config = {
    ...base,
    ...userCfg,
    iceServers: userIce ? [...base.iceServers, ...userIce] : base.iceServers,
  };

  return opts;
}

/**
 * WindConnector (DApp-side)
 * - Owns PeerJS instance (DApp is server peer)
 * - Creates VSR identity login request
 * - Waits for wallet connection + LOGIN_OK, then yields WalletSession
 */
export class WindConnector {
  /** @type {Peer | null} */
  #peer = null;

  /** @type {import("peerjs").PeerJSOption} */
  #peerOptions;

  /** @type {string | null} */
  #peerId = null;

  /** @type {Map<string, Function>} */
  #listeners = new Map();

  /** @type {any} */
  #identityArgs;

  /**
   * @param {import("peerjs").PeerJSOption=} options Optional PeerJS options.
   */
  constructor(options) {
    this.#peerOptions = mergePeerOptions(options);

    this.#identityArgs = {
      scope: "vexanium",
      chainId: WalletSession.ChainID,
      callback: originSafe(),
    };
  }

  /**
   * Add extra STUN/TURN server.
   * @param {RTCIceServer} server
   */
  addIceServer(server) {
    if (!this.#peerOptions.config) this.#peerOptions.config = { iceServers: [] };
    if (!Array.isArray(this.#peerOptions.config.iceServers)) this.#peerOptions.config.iceServers = [];
    this.#peerOptions.config.iceServers.push(server);
  }

  /**
   * Set PeerJS signaling server (optional).
   * @param {string} host
   * @param {number=} port
   * @param {string=} path
   * @param {boolean=} secure
   */
  setServer(host, port, path, secure) {
    this.#peerOptions.host = host;
    if (typeof port === "number") this.#peerOptions.port = port;
    if (typeof path === "string") this.#peerOptions.path = path;
    if (typeof secure === "boolean") this.#peerOptions.secure = secure;
  }

  /**
   * Subscribe to events.
   * Supported: "open", "close", "disconnected", "error", "connection", "session"
   * @param {string} event
   * @param {Function} func
   */
  on(event, func) {
    this.#listeners.set(String(event || ""), func);
  }

  /**
   * Unsubscribe.
   * @param {string} event
   */
  off(event) {
    this.#listeners.delete(String(event || ""));
  }

  /**
   * Connect to signaling server. Resolves when Peer is "open".
   * @returns {Promise<string>} peerId
   */
  async connect() {
    if (this.#peer && !this.#peer.destroyed) return this.#peer.id;

    const stored = loadSession();
    this.#peerId = stored?.peerID || this.#peerId || `VEX-${uuid()}`;

    const peer = new Peer(this.#peerId, this.#peerOptions);
    this.#peer = peer;

    peer.on("connection", (conn) => this.#onConnection(conn));

    // Bridge PeerJS events to our listeners (except "session" which is internal)
    for (const [key, fn] of this.#listeners.entries()) {
      if (key === "session") continue;
      try {
        peer.on(key, fn);
      } catch {}
    }

    return await new Promise((resolve, reject) => {
      const onOpen = (id) => {
        try {
          peer.off("error", onError);
        } catch {}
        resolve(id);
      };
      const onError = (err) => {
        try {
          peer.off("open", onOpen);
        } catch {}
        reject(err);
      };
      peer.once("open", onOpen);
      peer.once("error", onError);
    });
  }

  disconnect() {
    try {
      this.#peer?.disconnect();
    } catch {}
  }

  destroy() {
    try {
      this.#peer?.destroy();
    } catch {}
    this.#peer = null;
  }

  reconnect() {
    try {
      this.#peer?.reconnect();
    } catch {}
  }

  isDisconnected() {
    return this.#peer ? this.#peer.disconnected : true;
  }

  isDestroyed() {
    return this.#peer ? this.#peer.destroyed : true;
  }

  /**
   * Create VSR identity request for login.
   * Put this string into:
   *  - QR payload, or
   *  - wallet login URL query (?vsr=...)
   *
   * @param {string} name App name
   * @param {string=} icon App icon URL
   * @returns {string} "vsr:...."
   */
  createLoginRequest(name, icon) {
    const session = loadSession();

    if (session) {
      // reuse peer id + identity hints
      this.#peerId = session.peerID;

      const [actor, perm] = String(session.permission).split("@");
      this.#identityArgs.account = actor;
      this.#identityArgs.permission = perm;
    } else {
      clearSession();
      this.#peerId = `VEX-${uuid()}`;
      delete this.#identityArgs.account;
      delete this.#identityArgs.permission;
    }

    const req = SigningRequest.identity(this.#identityArgs, { zlib });

    // Compact app info keys
    req.setInfoKey("pi", this.#peerId); // peer id
    req.setInfoKey("na", String(name || "")); // app name
    if (icon) req.setInfoKey("ic", String(icon)); // icon
    req.setInfoKey("do", originSafe()); // dapp origin

    // If a stored auth proof exists, pass it (wallet may optimize)
    if (session?.auth) req.setInfoKey("auth", session.auth);

    return req.encode(true, false, "vsr:");
  }

  /**
   * @param {import("peerjs").DataConnection} conn
   */
  #onConnection(conn) {
    const onConn = this.#listeners.get("connection");
    if (onConn) onConn(conn);

    // Expect LOGIN_OK first (one-shot)
    conn.once("data", (payload) => {
      if (!payload || typeof payload !== "object") return;
      if (payload.code !== "LOGIN_OK") return;

      try {
        const auth = payload?.result?.auth;
        if (!auth || typeof auth !== "string") return;

        const proof = Serializer.decode({
          data: Base64u.decode(auth),
          type: IdentityProof,
        });

        const session = new WalletSession(conn);
        session.permissionLevel = proof.signer;

        saveSession({
          peerID: this.#peerId || conn.peer,
          permission: proof.signer.toString(),
          expiration: proof.expiration,
          auth,
        });

        const onSession = this.#listeners.get("session");
        if (onSession) onSession(session, proof);
      } catch (e) {
        const onError = this.#listeners.get("error");
        if (onError) onError(e);
      }
    });
  }
}