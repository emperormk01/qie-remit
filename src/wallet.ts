import type { Env } from "./types";

// AES-GCM encrypt/decrypt for the on-chain operator key (pattern from AuxloNeo).
async function deriveKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyData = enc.encode(secret.padEnd(32, "0").slice(0, 32));
  return crypto.subtle.importKey("raw", keyData, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptKey(plain: string, secret: string): Promise<string> {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plain));
  const combined = new Uint8Array(iv.length + ct.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ct), iv.length);
  return btoa(String.fromCharCode(...combined));
}

export async function decryptKey(cipher: string, secret: string): Promise<string> {
  const key = await deriveKey(secret);
  const combined = new Uint8Array(atob(cipher).split("").map((c) => c.charCodeAt(0)));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new TextDecoder().decode(pt);
}

interface StoredOperator {
  address: string;
  encryptedKey: string;
}

export async function loadOperator(env: Env): Promise<StoredOperator | null> {
  const raw = (await env.CONFIG.get("operator_wallet", "json")) as StoredOperator | null;
  if (!raw?.address || !raw?.encryptedKey) return null;
  return raw;
}

export async function getOperatorKey(env: Env): Promise<`0x${string}` | null> {
  const op = await loadOperator(env);
  if (!op) return null;
  try {
    return (await decryptKey(op.encryptedKey, env.WALLET_ENCRYPTION_KEY)) as `0x${string}`;
  } catch {
    return null;
  }
}

export async function ensureOperator(env: Env): Promise<StoredOperator> {
  const existing = await loadOperator(env);
  if (existing) return existing;
  if (!env.WALLET_ENCRYPTION_KEY) throw new Error("WALLET_ENCRYPTION_KEY is required");
  const { privateKeyToAccount } = await import("viem/accounts");
  const pk = generatePrivateKey() as `0x${string}`;
  const account = privateKeyToAccount(pk);
  const encKey = await encryptKey(pk, env.WALLET_ENCRYPTION_KEY);
  const stored: StoredOperator = { address: account.address, encryptedKey: encKey };
  await env.CONFIG.put("operator_wallet", JSON.stringify(stored));
  return stored;
}

function generatePrivateKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return "0x" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
