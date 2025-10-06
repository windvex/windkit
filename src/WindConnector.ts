import {
  Base64u,
  IdentityProof,
  SigningRequest,
  type SigningRequestCreateIdentityArguments
} from '@wharfkit/signing-request'
import { Int64, PermissionLevel, Serializer } from '@wharfkit/antelope'
import { Peer, type DataConnection, type PeerOptions } from 'peerjs'
import { WalletSession } from './WalletSession'
import { zlib } from './zlib'

/** Event yang didukung */
type WindConnectorEvent = 'open' | 'close' | 'disconnected' | 'error' | 'session'

type ListenerMap = Map<WindConnectorEvent | string, (...args: unknown[]) => void>

interface StoredSession {
  permission: string
  exp: number
  signature?: string
  domain: string
  peerId: string
}

/** Payload dari wallet saat koneksi pertama */
interface LoginOkPayload {
  code: 'LOGIN_OK'
  result: { auth: string; exp: number; signature?: string }
}
/** Payload dari wallet saat re-login (tanpa proof) */
interface ReLoginOkPayload {
  code: 'RE_LOGIN_OK'
  result: { permission: string }
}

type IncomingPayload = LoginOkPayload | ReLoginOkPayload

function assertBrowser(): void {
  if (typeof window === 'undefined' || typeof crypto === 'undefined') {
    throw new Error('WindConnector requires browser environment (window/crypto).')
  }
}

export class WindConnector {
  #peer?: Peer
  #peerOptions: PeerOptions = {}
  #peerId?: string
  #listeners: ListenerMap = new Map()
  #session: Map<string, StoredSession> = new Map()

  /** Argumen identity yang sesuai typing @wharfkit */
  #identityArgs: SigningRequestCreateIdentityArguments = {
    chainId: WalletSession.ChainID,
    scope: 'vexanium',
    // beberapa versi typing menandai callback required; berikan placeholder
  callback: { url: '', background: false }
  }

  constructor() {
    this.#peerOptions.config = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:3478' },
        { urls: 'stun:stun.relay.metered.ca:80' },
        {
          urls: 'turn:asia.relay.metered.ca:80',
          username: 'b66cd40a117bddb5cde924ab',
          credential: '4jRmuTehVCZ2a/S+'
        }
      ],
      sdpSemantics: 'unified-plan'
    }
    this.#loadSession()
  }

  addIceServer(server: RTCIceServer) {
    if (!this.#peerOptions.config) this.#peerOptions.config = { iceServers: [] }
    ;(this.#peerOptions.config.iceServers as RTCIceServer[]).push(server)
  }

  setServer(host: string, port?: number) {
    this.#peerOptions.host = host
    if (typeof port === 'number') this.#peerOptions.port = port
  }

  /** Events: `open`, `close`, `disconnected`, `error`, `session` */
  on(event: WindConnectorEvent | string, func: (...args: unknown[]) => void) {
    this.#listeners.set(event, func)
  }

  async connect() {
    assertBrowser()
    if (!this.#peerId) throw new Error('Peer ID is not set')
    this.#peer = new Peer(this.#peerId, this.#peerOptions)
    this.#peer.on('connection', this.#onConnection.bind(this))
    this.#listeners.forEach((func, key) => this.#peer!.on(key as any, func))
  }

  disconnect() { this.#peer?.disconnect() }
  destroy() { this.#peer?.destroy() }
  reconnect() { this.#peer?.reconnect() }

  isDisconnected(): boolean { return Boolean(this.#peer?.disconnected) }
  isDestroyed(): boolean { return Boolean(this.#peer?.destroyed) }

  /**
   * Membuat VSR login untuk QR/URL.
   * @param name - App name
   * @param icon - Icon URL
   */
  createLoginRequest(name: string, icon: string): string {
    assertBrowser()
    const session = this.#getLastSession()
    if (session) {
      const [actor, perm] = session.permission.split('@')
      this.#identityArgs.account = actor
      this.#identityArgs.permission = perm
      this.#peerId = session.peerId
    } else {
      this.#peerId = `VEX-${crypto.randomUUID()}`
      // bersihkan akun/permission lama kalau ada
      delete this.#identityArgs.account
      delete this.#identityArgs.permission
    }

    const req = SigningRequest.identity(this.#identityArgs, { zlib })
    req.setInfoKey('pi', this.#peerId)                // peer id
    req.setInfoKey('na', name)                        // app name
    req.setInfoKey('ic', icon)                        // icon url
    req.setInfoKey('do', window.location.origin)      // domain origin

    if (session) {
      req.setInfoKey('exp', Int64.from(session.exp))
      if (session.signature) req.setInfoKey('sig', session.signature)
    }
    return req.encode(true, false, 'vsr:')
  }

  /** ===== internal helpers ===== */
  #getLastSession(): StoredSession | null {
    const domain = typeof window !== 'undefined' ? window.location.origin : ''
    if (!domain) return null
    const current = this.#session.get(domain)
    if (current && current.exp >= Date.now()) return current
    if (current) this.#session.delete(domain)
    return null
  }

  #addSession(permission: string, exp: number, signature?: string) {
    const domain = window.location.origin
    const peerId = this.#peerId ?? `VEX-${crypto.randomUUID()}`
    const current: StoredSession = { permission, exp, signature, domain, peerId }
    this.#session.set(domain, current)
  }

  #saveSession() {
    const data = Array.from(this.#session.values())
    sessionStorage.setItem('session', JSON.stringify(data))
  }

  #loadSession() {
    if (typeof window === 'undefined') return
    const raw = sessionStorage.getItem('session')
    if (!raw) return
    try {
      const data = JSON.parse(raw) as StoredSession[]
      for (const it of data) this.#session.set(it.domain, it)
    } catch {
      // corrupted storage → reset
      sessionStorage.removeItem('session')
    }
  }

  #onConnection(conn: DataConnection) {
    conn.once('data', (payload: unknown) => {
      const p = payload as IncomingPayload
      if (p.code === 'LOGIN_OK') {
        const auth = Base64u.decode(p.result.auth)
        const proof = Serializer.decode({ data: auth, type: IdentityProof })
        const session = new WalletSession(conn)
        session.permissionLevel = proof.signer

        this.#addSession(proof.signer.toString(), p.result.exp, p.result.signature)
        this.#saveSession()

        this.#listeners.get('session')?.(session, proof)
      } else if (p.code === 'RE_LOGIN_OK') {
        const session = new WalletSession(conn)
        session.permissionLevel = PermissionLevel.from(p.result.permission)
        this.#listeners.get('session')?.(session)
      }
    })
  }
}
