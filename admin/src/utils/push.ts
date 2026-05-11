import { api } from "../api";

type PushKeyInfo = { enabled: boolean; public_key?: string };

// base64url → ArrayBuffer, for the applicationServerKey arg of
// pushManager.subscribe(). VAPID public keys are 65-byte uncompressed
// P-256 points, base64url-encoded with no padding. We return a fresh
// ArrayBuffer (not Uint8Array view) so the type matches BufferSource
// strictly under TypeScript 5.7+.
function b64UrlToBuffer(b64: string): ArrayBuffer {
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const std = padded.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(std);
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buf;
}

// Convert a PushSubscription's binary key material into the base64url
// strings the backend expects. getKey returns an ArrayBuffer; the push
// service itself sends keys in base64url, but the browser hands them
// back as raw bytes, so we re-encode.
function bytesToB64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type PushState =
  | { kind: "unsupported" }                       // browser has no SW or no PushManager
  | { kind: "disabled-by-server" }                // VAPID not configured on the backend
  | { kind: "permission-denied" }                 // user blocked notifications
  | { kind: "permission-default" }                // never asked yet
  | { kind: "subscribed"; endpoint: string };     // we're good

export async function getPushState(): Promise<PushState> {
  if (typeof window === "undefined") return { kind: "unsupported" };
  if (!("serviceWorker" in navigator) || !("PushManager" in window) ||
      typeof Notification === "undefined") {
    return { kind: "unsupported" };
  }

  // Backend gates on VAPID config — no point prompting the user if we
  // can't deliver pushes anyway.
  const info: PushKeyInfo = await api.getPushPublicKey().catch(() => ({ enabled: false }));
  if (!info.enabled) return { kind: "disabled-by-server" };

  if (Notification.permission === "denied") return { kind: "permission-denied" };
  if (Notification.permission === "default") return { kind: "permission-default" };

  // Permission granted — we should have a subscription. If not, the caller
  // can call enablePush() to (silently) create one.
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return { kind: "permission-default" };
  return { kind: "subscribed", endpoint: sub.endpoint };
}

export async function enablePush(): Promise<PushState> {
  if (typeof window === "undefined") return { kind: "unsupported" };
  if (!("serviceWorker" in navigator) || !("PushManager" in window) ||
      typeof Notification === "undefined") {
    return { kind: "unsupported" };
  }

  const info: PushKeyInfo = await api.getPushPublicKey().catch(() => ({ enabled: false }));
  if (!info.enabled || !info.public_key) return { kind: "disabled-by-server" };
  const pubKey = info.public_key;

  const perm = await Notification.requestPermission().catch(() => "denied" as NotificationPermission);
  if (perm !== "granted") {
    return perm === "denied" ? { kind: "permission-denied" } : { kind: "permission-default" };
  }

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64UrlToBuffer(pubKey),
    });
  }

  const p256dh = sub.getKey("p256dh");
  const auth = sub.getKey("auth");
  if (!p256dh || !auth) {
    // Shouldn't happen for a fresh subscription, but guard so we don't
    // POST a partial record the backend would reject.
    return { kind: "permission-default" };
  }
  await api.subscribePush({
    endpoint: sub.endpoint,
    keys: { p256dh: bytesToB64Url(p256dh), auth: bytesToB64Url(auth) },
  });
  return { kind: "subscribed", endpoint: sub.endpoint };
}

export async function disablePush(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await sub.unsubscribe().catch(() => {});
  await api.unsubscribePush(sub.endpoint).catch(() => {});
}
