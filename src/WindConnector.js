import { Base64u, IdentityProof, SigningRequest } from "@wharfkit/signing-request";
import { Int64, PermissionLevel, Serializer } from "@wharfkit/antelope";
import { Peer } from "peerjs";
import zlib from "pako";
import { WalletSession } from "./WalletSession.js";

/**
 * Handles communication with the signaling server
 * and manages secure DApp ↔ Wallet sessions.
 */
export class WindConnector {
    #peer;
    #peerOptions = {};
    #peerId;
    #listeners = new Map();
    #session = new Map();
    #identityArgs = {};

    constructor() {
        this.#peerOptions.config = {
            iceServers: [
                { urls: "stun:stun.l.google.com:19302" },
                { urls: "stun:stun1.l.google.com:3478" },
                { urls: "stun:stun.relay.metered.ca:80" },
                {
                    urls: "turn:asia.relay.metered.ca:80",
                    username: "b66cd40a117bddb5cde924ab",
                    credential: "4jRmuTehVCZ2a/S+"
                }
            ],
            sdpSemantics: "unified-plan"
        };
        this.#identityArgs.scope = "vexanium";
        this.#identityArgs.chainId = WalletSession.ChainID;
        this.#loadSession();
    }

    /**
     * Adds an additional STUN or TURN server to the peer connection.
     * @param {RTCIceServer} server
     */
    addIceServer(server) {
        this.#peerOptions.config.iceServers.push(server);
    }

    /**
     * Sets the signaling server address and port.
     * @param {string} host
     * @param {number} [port]
     */
    setServer(host, port) {
        this.#peerOptions.host = host;
        if (port) this.#peerOptions.port = port;
    }

    /**
     * Registers a listener for specific peer events.
     * Supported events: `open`, `close`, `disconnected`, `error`, `session`
     * @param {string} event
     * @param {Function} func
     */
    on(event, func) {
        this.#listeners.set(event, func);
    }

    /**
     * Connects to the signaling server.
     * The wallet's response can be captured using the `session` event listener.
     *
     * @see on
     * @see createLoginRequest
     */
    async connect() {
        if (!this.#peerId) throw new Error("Peer ID is not set");
        this.#peer = new Peer(this.#peerId, this.#peerOptions);
        this.#peer.on("connection", this.#onConnection.bind(this));
        this.#listeners.forEach((func, key) => {
            this.#peer.on(key, func);
        });
    }

    disconnect() {
        this.#peer.disconnect();
    }

    destroy() {
        this.#peer.destroy();
    }

    reconnect() {
        this.#peer.reconnect();
    }

    isDisconnected() {
        return this.#peer.disconnected;
    }

    isDestroyed() {
        return this.#peer.destroyed;
    }

    /**
     * Creates a VSR (Vexanium Signing Request) for login.
     * @param {string} name - Application name
     * @param {string} icon - Application icon URL
     * @returns {string} Encoded VSR string for use in QR codes or query URLs
     */
    createLoginRequest(name, icon) {
        const session = this.#getLastSession();
        if (session) {
            const [actor, perm] = session.permission.split("@");
            this.#identityArgs.account = actor;
            this.#identityArgs.permission = perm;
            this.#peerId = session.peerId;
        } else {
            // Generate a new peer ID
            this.#peerId = `VEX-${window.crypto.randomUUID()}`;
        }
        let req = SigningRequest.identity(this.#identityArgs, { zlib });
        req.setInfoKey("pi", this.#peerId);
        req.setInfoKey("na", name);
        req.setInfoKey("ic", icon);
        req.setInfoKey("do", window.location.origin);
        if (session) {
            req.setInfoKey("exp", Int64.from(session.exp));
            req.setInfoKey("sig", session.signature);
        }
        return req.encode(true, false, "vsr:");
    }

    #getLastSession() {
        const domain = window.location.origin;
        let current = this.#session.get(domain);
        if (current && current.exp < Date.now()) { // Expired
            this.#session.delete(domain);
            current = null;
        }
        return current;
    }

    #addSession(permission, exp, signature) {
        const domain = window.location.origin;
        let current = this.#session.get(domain);
        if (current) {
            current.permission = permission;
            current.exp = exp;
            current.signature = signature;
        } else {
            current = {
                permission, exp, signature, domain, peerId: this.#peerId
            };
        }
        this.#session.set(domain, current);
    }

    #saveSession() {
        const data = Array.from(this.#session.values());
        sessionStorage.setItem("session", JSON.stringify(data));
    }

    #loadSession() {
        const raw = sessionStorage.getItem("session");
        if (raw) {
            let data = JSON.parse(raw);
            data.forEach(it => {
                this.#session.set(it.domain, it);
            });
        }
    }

    /**
     * Handles incoming peer connections from the wallet.
     * @param {DataConnection} conn
     * @private
     */
    #onConnection(conn) {
        conn.once("data", payload => {
            if (payload.code === 'LOGIN_OK') {
                const auth = Base64u.decode(payload.result.auth);
                const proof = Serializer.decode({ data: auth, type: IdentityProof });
                const session = new WalletSession(conn);
                session.permissionLevel = proof.signer;

                // Store session
                this.#addSession(proof.signer.toString(), payload.result.exp, payload.result.signature);
                this.#saveSession();

                const func = this.#listeners.get("session");
                if (func) func(session, proof);
            } else if (payload.code === 'RE_LOGIN_OK') {
                const session = new WalletSession(conn);
                session.permissionLevel = PermissionLevel.from(payload.result.permission);

                const func = this.#listeners.get("session");
                if (func) func(session); // Only one parameter for re-login
            }
        });
    }
}