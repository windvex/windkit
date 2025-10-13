import { SigningRequest } from '@wharfkit/signing-request'
import {
  Action,
  Checksum512,
  Name,
  PermissionLevel,
  PublicKey,
  Signature,
  SignedTransaction,
  Transaction,
  type SignedTransactionType
} from '@wharfkit/antelope'
import { ABICache } from '@wharfkit/abicache'
import type { DataConnection } from 'peerjs'
import { zlib, type ZlibProvider } from './zlib'

type SendTxResponse = unknown

export interface TransactArguments {
  action?: Action
  actions?: Action[]
  transaction?: Transaction
  chainId?: string
}

export interface TransactOptions {
  broadcast?: boolean
}

type PendingCallback = (reply: unknown) => void

function assertBrowser(): void {
  if (typeof window === 'undefined' || typeof crypto === 'undefined') {
    throw new Error('WalletSession requires browser environment (window/crypto).')
  }
}

export class WalletSession {
  static readonly ChainID =
    'f9f432b1851b5c179d2091a96f593aaed50ec7466b74f89301f957a83e56ce1f'

  #connection: DataConnection
  #callbacks: Map<string, PendingCallback>
  #encodingOptions?: { zlib: ZlibProvider; abiProvider?: ABICache }
  #permissionLevel?: PermissionLevel
  #closeListener?: () => void
  #errorListener?: (err: unknown) => void

  constructor(connection: DataConnection) {
    this.#connection = connection
    this.#callbacks = new Map()

    connection.on('data', (data: unknown) => this.#onDataReceived(data))
    connection.on('close', () => this.#closeListener?.())
    connection.on('error', (error) => this.#errorListener?.(error))
  }

  setABICache(cache: ABICache) {
    this.#encodingOptions = { zlib, abiProvider: cache }
  }

  onClose(listener: () => void) {
    this.#closeListener = listener
  }

  onError(listener: (err: unknown) => void) {
    this.#errorListener = listener
  }

  isOpen(): boolean {
    return Boolean(this.#connection.open)
  }

  close(): void {
    this.#connection.close()
  }

  get permissionLevel(): PermissionLevel | undefined {
    return this.#permissionLevel
  }
  set permissionLevel(value: PermissionLevel | undefined) {
    this.#permissionLevel = value
  }

  get actor(): Name | undefined {
    return this.#permissionLevel?.actor
  }

  get permission(): Name | undefined {
    return this.#permissionLevel?.permission
  }

  async transact(
    args: TransactArguments,
    options?: TransactOptions
  ): Promise<SignedTransaction | SendTxResponse> {
    assertBrowser()
    args.chainId = WalletSession.ChainID
    const willBroadcast = options?.broadcast ?? true

    const request = await SigningRequest.create(
      args,
      this.#encodingOptions ?? { zlib }
    )
    request.setBroadcast(willBroadcast)

    const vsr = request.encode(true, false, 'vsr:')
    return this.signingRequest(vsr)
  }

  signingRequest(vsr: string): Promise<SignedTransaction | SendTxResponse> {
    assertBrowser()
    const callback = crypto.randomUUID()
    const data = { method: 'signingRequest', id: callback, params: { vsr } }

    return new Promise((resolve, reject) => {
      const func: PendingCallback = (reply: unknown) => {
        const r = reply as { code: string; result?: unknown; error?: unknown }
        if (r.code === 'SENT') {
          resolve(r.result as SendTxResponse)
        } else if (r.code === 'SIGNED') {
          resolve(SignedTransaction.from(r.result as SignedTransactionType))
        } else {
          const err =
            typeof r.error === 'string'
              ? new Error(r.error)
              : (r.error as Error) ?? new Error('Unknown error')
          reject(err)
        }
      }
      this.#callbacks.set(callback, func)
      this.#connection.send(data)
    })
  }

  signMessage(message: string): Promise<Signature> {
    assertBrowser()
    const callback = crypto.randomUUID()
    const data = { method: 'signMessage', id: callback, params: { message } }

    return new Promise((resolve, reject) => {
      const func: PendingCallback = (reply: unknown) => {
        const r = reply as { code: string; result?: { signature: string }; error?: { message?: string } }
        if (r.code === 'SIGNED' && r.result?.signature) {
          resolve(Signature.from(r.result.signature))
        } else {
          reject(new Error(r.error?.message ?? 'Sign message failed'))
        }
      }
      this.#callbacks.set(callback, func)
      this.#connection.send(data)
    })
  }

  sharedSecret(publicKey: PublicKey): Promise<Checksum512> {
    assertBrowser()
    const callback = crypto.randomUUID()
    const data = {
      method: 'sharedSecret',
      id: callback,
      params: { key: publicKey.toString() }
    }

    return new Promise((resolve, reject) => {
      const func: PendingCallback = (reply: unknown) => {
        const r = reply as { code: string; result?: { secret: string }; error?: unknown }
        if (r.code === 'CREATED' && r.result?.secret) {
          resolve(Checksum512.from(r.result.secret))
        } else {
          reject(new Error(String(r.error ?? 'ECDH failed')))
        }
      }
      this.#callbacks.set(callback, func)
      this.#connection.send(data)
    })
  }

  #onDataReceived(data: unknown) {
    if (!data || typeof data !== 'object') return
    const maybe = data as { id?: string }
    if (!maybe.id || typeof maybe.id !== 'string') return
    const callback = this.#callbacks.get(maybe.id)
    if (callback) {
      callback(data)
      this.#callbacks.delete(maybe.id)
    }
  }
}
