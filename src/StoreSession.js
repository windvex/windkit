// windkit/StoreSession.js
// Ultra Clean++ (single replace)
// ✅ sessionStorage SSOT for pairing
// ✅ auto-clear invalid/expired
// ✅ safe storage guards (private mode / SSR)

import { TimePointSec } from "@wharfkit/antelope";

const KEY = "vex-session";

function hasSessionStorage() {
  try {
    return typeof sessionStorage !== "undefined" && sessionStorage != null;
  } catch {
    return false;
  }
}

/**
 * @typedef {Object} StoredSession
 * @property {string} peerID
 * @property {string} permission           // "account@active"
 * @property {string|TimePointSec} expiration
 * @property {string} auth                 // Base64u IdentityProof payload
 */

export function saveSession(data) {
  if (!hasSessionStorage()) return;

  const exp =
    typeof data?.expiration === "string"
      ? data.expiration
      : data?.expiration?.toString?.() ?? String(data?.expiration ?? "");

  const payload = {
    peerID: String(data?.peerID || ""),
    permission: String(data?.permission || ""),
    expiration: String(exp || ""),
    auth: String(data?.auth || ""),
  };

  try {
    sessionStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // ignore (quota/private mode)
  }
}

export function clearSession() {
  if (!hasSessionStorage()) return;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/**
 * Load session from sessionStorage (auto-clears if invalid/expired).
 * @returns {null | {peerID:string, permission:string, expiration:TimePointSec, auth:string}}
 */
export function loadSession() {
  if (!hasSessionStorage()) return null;

  let raw = "";
  try {
    raw = sessionStorage.getItem(KEY) || "";
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") {
      clearSession();
      return null;
    }

    const peerID = String(data.peerID || "");
    const permission = String(data.permission || "");
    const auth = String(data.auth || "");
    const expRaw = String(data.expiration || "");

    if (!peerID || !permission || !auth || !expRaw) {
      clearSession();
      return null;
    }

    const expiration = TimePointSec.fromString(expRaw);
    const expMs = expiration.toDate().getTime();

    if (!Number.isFinite(expMs) || expMs <= Date.now()) {
      clearSession();
      return null;
    }

    return { peerID, permission, expiration, auth };
  } catch {
    clearSession();
    return null;
  }
}