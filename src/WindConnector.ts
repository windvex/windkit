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

type WindConnectorEvent = 'open' | 'close' | 'disconnected' | 'error' | 'session'
type Listener = (...args: unknown[]) => void
type ListenerMap = Map<WindConnectorEvent | string, Listener>

interface StoredSession {
  permission: string
  exp: number
  signature?: string
  domain: string
  peerId: string
}

interface LoginOkPayload {
  code: 'LOGIN_OK'
  result: { auth: string; exp: number; signature?: string }
}
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

function isTurn(server: RTCIceServer): boolean {
  const urls = Array.isArray(server.urls) ? server.urls : [server.urls]
  return urls.some(u => typeof u === 'string' && (u.startsWith('turn:') || u.startsWith('turns:')))
}

function ensureTurnHasCred(server: RTCIceServer): void {
  if (isTurn(server) && (!server.username || !server.credential)) {
    throw new Error('TURN server requires username and credential.')
  }
}

export class WindConnector {
  #peer?: Peer
  #peerOptions: PeerOptions
  #peerId?: string
  #listeners: ListenerMap = new Map()
  #session: Map<string, StoredSession> = new Map()

  #identityArgs: SigningRequestCreateIdentityArguments = {
    chainId: WalletSession.ChainID,
    scope: 'vexanium',
    callback: { url: '', background: false }
  }

  constructor() {
    this.#peerOptions = {
      host: 'core.windcrypto.com',
      port: 443,
      secure: true,
      path: '/',
      key: 'peerjs',
      config: {
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
    }
    for (const s of this.#peerOptions.config!.iceServers ?? []) ensureTurnHasCred(s)
    this.#loadSession()
  }

 
  setServer(host: string, opts?: { port?: number; secure?: boolean; path?: string; key?: string }) {
    if (!host) throw new Error('host is required')
    this.#peerOptions.host = host
    if (typeof opts?.port === 'number') this.#peerOptions.port = opts.port
    if (typeof opts?.secure === 'boolean') this.#peerOptions.secure = opts.secure
    if (typeof opts?.path === 'string') this.#peerOptions.path = opts.path
    if (typeof opts?.key === 'string') this.#peerOptions.key = opts.key
  }
  setPath(path: string) { this.#peerOptions.path = path || '/' }
  setKey(key: string) { this.#peerOptions.key = key || 'peerjs' }
  setSecure(v: boolean) { this.#peerOptions.secure = !!v }
  setPort(port: number) { this.#peerOptions.port = port }

  configureForCore() {
    this.setServer('core.windcrypto.com', { port: 443, secure: true, path: '/', key: 'peerjs' })
  }

  addIceServer(server: RTCIceServer) {
    ensureTurnHasCred(server)
    const cfg = this.#peerOptions.config ?? (this.#peerOptions.config = { iceServers: [] })
    ;(cfg.iceServers ?? (cfg.iceServers = [])).push(server)
  }

  setIceServers(servers: RTCIceServer[]) {
    for (const s of servers) ensureTurnHasCred(s)
    const cfg = this.#peerOptions.config ?? (this.#peerOptions.config = { iceServers: [] })
    cfg.iceServers = servers.slice()
  }

  clearIceServers() {
    const cfg = this.#peerOptions.config ?? (this.#peerOptions.config = { iceServers: [] })
    cfg.iceServers = []
  }

 
  on(event: WindConnectorEvent | string, func: Listener) {
    this.#listeners.set(event, func)
  }
  off(event: WindConnectorEvent | string) {
    this.#listeners.delete(event)
  }
  #emit(event: WindConnectorEvent | string, ...args: unknown[]) {
    this.#listeners.get(event)?.(...args)
  }

 
  async connect(): Promise<void> {
    assertBrowser()
    if (!this.#peerId) throw new Error('Peer ID is not set. Call createLoginRequest() first.')
    this.#peer = new Peer(this.#peerId, this.#peerOptions)

    this.#peer.on('open',     (id: string) => this.#emit('open', id))
    this.#peer.on('close',    () => this.#emit('close'))
    this.#peer.on('disconnected', () => this.#emit('disconnected'))
    this.#peer.on('error',    (err: unknown) => this.#emit('error', err))

    this.#peer.on('connection', this.#onConnection.bind(this))
  }

  disconnect(): void { this.#peer?.disconnect() }
  destroy(): void { this.#peer?.destroy() }
  reconnect(): void { this.#peer?.reconnect() }

  isDisconnected(): boolean { return Boolean(this.#peer?.disconnected) }
  isDestroyed(): boolean { return Boolean(this.#peer?.destroyed) }

  get peerId(): string | undefined { return this.#peerId }

  createLoginRequest(appName: string, iconUrl: string): string {
    assertBrowser()
    const session = this.#getLastSession()

    if (session) {
      const [actor, perm] = session.permission.split('@')
      this.#identityArgs.account = actor
      this.#identityArgs.permission = perm
      this.#peerId = session.peerId
    } else {
      this.#peerId = `VEX-${crypto.randomUUID()}`
      delete this.#identityArgs.account
      delete this.#identityArgs.permission
    }

    const req = SigningRequest.identity(this.#identityArgs, { zlib })
    req.setInfoKey('pi', this.#peerId)                  // peer id
    req.setInfoKey('na', appName)                       // app name
    req.setInfoKey('ic', iconUrl)                       // icon url
    req.setInfoKey('do', window.location.origin)        // domain origin

    if (session) {
      req.setInfoKey('exp', Int64.from(session.exp))
      if (session.signature) req.setInfoKey('sig', session.signature)
    }
    return req.encode(true, false, 'vsr:')
  }

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
      sessionStorage.removeItem('session')
    }
  }

  #onConnection(conn: DataConnection) {
    conn.once('data', (payload: unknown) => {
      const p = payload as IncomingPayload
      if (!p || typeof (p as any).code !== 'string') return

      if (p.code === 'LOGIN_OK') {
        const auth = Base64u.decode(p.result.auth)
        const proof = Serializer.decode({ data: auth, type: IdentityProof })
        const session = new WalletSession(conn)
        session.permissionLevel = proof.signer

        this.#addSession(proof.signer.toString(), p.result.exp, p.result.signature)
        this.#saveSession()

        this.#emit('session', session, proof)
      } else if (p.code === 'RE_LOGIN_OK') {
        const session = new WalletSession(conn)
        session.permissionLevel = PermissionLevel.from(p.result.permission)
        this.#emit('session', session)
      }
    })
  }
}
