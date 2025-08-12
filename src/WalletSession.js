import { SigningRequest } from "@wharfkit/signing-request";
import {
  Action,
  Checksum512,
  Name,
  PermissionLevel,
  PublicKey,
  Signature,
  SignedTransaction,
  Transaction
} from "@wharfkit/antelope";
import { ABICache } from "@wharfkit/abicache";
import zlib from "pako";

export class WalletSession {
  // Vexanium mainnet Chain ID (constant)
  static ChainID = "f9f432b1851b5c179d2091a96f593aaed50ec7466b74f89301f957a83e56ce1f";

  #connection;
  #callbacks;
  #encodingOptions;
  /**
   * @type {PermissionLevel}
   */
  #permissionLevel;
  #closeListener;
  #errorListener;

  /**
   * Wraps a DataConnection to communicate with the wallet.
   * @param {import('peerjs').DataConnection} connection
   */
  constructor(connection) {
    this.#connection = connection;
    this.#callbacks = new Map();

    connection.on("data", this.#onDataReceived.bind(this));
    connection.on("close", () => {
      if (this.#closeListener) this.#closeListener();
    });
    connection.on("error", (error) => {
      if (this.#errorListener) this.#errorListener(error);
    });
  }

  /**
   * Sets the ABI cache to use for request (de)serialization.
   * @param {ABICache} cache
   */
  setABICache(cache) {
    this.#encodingOptions = { zlib, abiProvider: cache };
  }

  /**
   * Registers a listener invoked when the wallet connection closes.
   * @param {() => void} listener
   */
  onClose(listener) {
    this.#closeListener = listener;
  }

  /**
   * Registers a listener invoked when a connection error occurs.
   * @param {(err: unknown) => void} listener
   */
  onError(listener) {
    this.#errorListener = listener;
  }

  /**
   * Indicates whether the wallet connection is still open.
   * @return {boolean}
   */
  isOpen() {
    return this.#connection.open;
  }

  /**
   * Closes the connection to the wallet.
   */
  close() {
    this.#connection.close();
  }

  /**
   * The active permission level granted by the wallet.
   * @return {PermissionLevel}
   */
  get permissionLevel() {
    return this.#permissionLevel;
  }

  /**
   * @param {PermissionLevel} value
   */
  set permissionLevel(value) {
    this.#permissionLevel = value;
  }

  /**
   * Convenience accessor for the actor name.
   * @return {Name}
   */
  get actor() {
    return this.#permissionLevel.actor;
  }

  /**
   * Convenience accessor for the permission name.
   * @return {Name}
   */
  get permission() {
    return this.#permissionLevel.permission;
  }

  /**
   * @typedef TransactArguments
   * @property {Action} [action]     Single-action transaction
   * @property {Action[]} [actions]  Multi-action transaction
   * @property {Transaction} [transaction]  Fully-formed transaction
   */

  /**
   * @typedef TransactOptions
   * @property {boolean} [broadcast=true]  If true, broadcast on-chain; otherwise sign only.
   */

  /**
   * Builds and sends a transaction request to the wallet.
   * @param {TransactArguments} args
   * @param {TransactOptions} [options]
   * @return {Promise<SignedTransaction|import('@wharfkit/antelope').SendTransactionResponse>}
   */
  async transact(args, options) {
    args.chainId = WalletSession.ChainID;
    const willBroadcast =
      options && typeof options.broadcast !== "undefined"
        ? options.broadcast
        : true;

    const request = await SigningRequest.create(args, this.#encodingOptions);
    request.setBroadcast(willBroadcast);

    const vsr = request.encode(true, false, "vsr:");
    return this.signingRequest(vsr);
  }

  /**
   * Sends a VSR (Vexanium Signing Request) to the wallet.
   * The wallet may broadcast the transaction immediately or return a signature only.
   * @param {string} vsr
   * @return {Promise<import('@wharfkit/antelope').SendTransactionResponse|SignedTransaction>}
   */
  signingRequest(vsr) {
    const callback = window.crypto.randomUUID();
    const data = {
      method: "signingRequest",
      id: callback,
      params: { vsr }
    };

    return new Promise((resolve, reject) => {
      const func = (reply) => {
        if (reply.code === "SENT") {
          resolve(reply.result);
        } else if (reply.code === "SIGNED") {
          resolve(SignedTransaction.from(reply.result));
        } else {
          // ERROR | REJECT
          if (typeof reply.error === "string") {
            reject(new Error(reply.error));
          } else {
            reject(reply.error);
          }
        }
      };
      this.#callbacks.set(callback, func);
      this.#connection.send(data);
    });
  }

  /**
   * Requests a signature for an arbitrary message.
   * @param {string} message  The message to be signed
   * @return {Promise<Signature>}
   */
  signMessage(message) {
    const callback = window.crypto.randomUUID();
    const data = {
      method: "signMessage",
      id: callback,
      params: { message }
    };

    return new Promise((resolve, reject) => {
      const func = (reply) => {
        if (reply.code === "SIGNED") {
          resolve(Signature.from(reply.result.signature));
        } else {
          reject(new Error(reply.error.message));
        }
      };
      this.#callbacks.set(callback, func);
      this.#connection.send(data);
    });
  }

  /**
   * Derives a shared secret using ECDH with the wallet's key.
   * @param {PublicKey} publicKey
   * @return {Promise<Checksum512>}
   */
  sharedSecret(publicKey) {
    const callback = window.crypto.randomUUID();
    const data = {
      method: "sharedSecret",
      id: callback,
      params: { key: publicKey.toString() }
    };

    return new Promise((resolve, reject) => {
      const func = (reply) => {
        if (reply.code === "CREATED") {
          resolve(Checksum512.from(reply.result.secret));
        } else if (reply.code === "ERROR") {
          reject(new Error(reply.error));
        }
      };
      this.#callbacks.set(callback, func);
      this.#connection.send(data);
    });
  }

  /**
   * Handles incoming data from the wallet and resolves the pending callback.
   * @param {{ id: string }} data
   * @private
   */
  #onDataReceived(data) {
    const callback = this.#callbacks.get(data.id);
    if (callback) {
      callback(data);
      this.#callbacks.delete(data.id);
    }
  }
}