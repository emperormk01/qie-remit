import type { Env } from "./types";
import { isAddress as viemIsAddress, getAddress as viemGetAddress } from "viem";

/** Telegram user IDs are authorized if ALLOWED_USERS is unset (open) or contains the id. */
export async function checkAllowed(env: Env, tgUserId: number): Promise<boolean> {
  if (!env.ALLOWED_USERS) return true; // open access by default
  const allowed = env.ALLOWED_USERS.split(",").map((s) => s.trim()).filter(Boolean);
  return allowed.includes(String(tgUserId));
}

export function requireAuth(env: Env, request: Request): boolean {
  if (!env.API_KEY) return false;
  const auth = request.headers.get("Authorization");
  return auth === `Bearer ${env.API_KEY}`;
}

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders, ...extra },
  });
}

export function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", ...corsHeaders },
  });
}

export function userId(tgId: number): string {
  return `telegram:${tgId}`;
}

export function genId(prefix?: string): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  return prefix ? `${prefix}-${hex.slice(0, 8).toUpperCase()}` : hex;
}

/** 6-char base32 slug for remit links (collision-resistant enough for a hackathon). */
export function genSlug(_seed?: string): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => alphabet[b % 32]).join("");
}

export function publicId(): string {
  return "INV-" + genId().slice(0, 8).toUpperCase();
}

export function shortHash(hash: string | null): string {
  if (!hash) return "—";
  return hash.slice(0, 10) + "…" + hash.slice(-6);
}

export function shortAddr(addr: string | null | undefined): string {
  if (!addr) return "—";
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

export function fmtDate(epochMs: number | null): string {
  if (!epochMs) return "—";
  return new Date(epochMs).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

/**
 * Strict EIP-55 address validation via viem.
 * - All-lowercase or all-uppercase (no checksum) -> valid (no checksum to fail).
 * - Mixed-case that FAILS EIP-55 checksum -> invalid (catches a pasted Polygon
 *   address mistyped as a QIE one, or a truncated/corrupted address).
 * This is stricter than the old local regex, which only checked 0x + 40 hex.
 */
export function isValidAddress(s: string): boolean {
  return viemIsAddress(s.trim(), { strict: true });
}

/**
 * Normalize an address to its EIP-55 checksummed form (viem getAddress).
 * Use this before STORING an address so downstream display/encode is consistent.
 * Throws on invalid input — callers should isValidAddress() first.
 */
export function checksumAddress(s: string): `0x${string}` {
  return viemGetAddress(s.trim());
}

export function isAddress(s: string): boolean {
  return isValidAddress(s);
}

export function isValidSlug(s: string): boolean {
  return /^[a-z0-9]([a-z0-9-]{1,30}[a-z0-9])?$/.test(s);
}

export function parseAmount(s: string): number | null {
  const n = Number(s.replace(/[, _]/g, ""));
  if (!isFinite(n) || n <= 0) return null;
  return Math.round(n * 1e6) / 1e6; // 6-decimal precision
}
