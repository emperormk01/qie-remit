import type { Env } from "./types";
import type { D1Result } from "@cloudflare/workers-types";

export interface UserRow {
  id: string; // "telegram:<tgUserId>"
  tg_user_id: number;
  username: string | null;
  wallet_address: string | null; // freelancer's QIE address (receives payments)
  pass_name: string | null; // on-chain attested identity name
  pass_verified: number; // 0/1
  pass_id: string | null; // on-chain attestation tx hash
  remit_slug: string | null; // paypal.me-style slug
  created_at: number;
  updated_at: number;
}

export interface InvoiceRow {
  id: string; // INV-XXXX
  on_chain_id: number; // InvoiceRegistry invoice id
  creator_id: string; // users.id
  creator_address: string;
  amount: number; // human QIE
  currency: string; // "QIE"
  description: string;
  client_name: string | null;
  slug: string; // payment page slug
  status: string; // pending | paid | cancelled
  create_tx: string | null;
  pay_tx: string | null;
  payer_address: string | null;
  paid_at: number | null;
  created_at: number;
}

export interface PaymentRow {
  invoice_id: string;
  on_chain_id: number;
  tx_hash: string;
  payer: string;
  amount: number;
  paid_at: number;
}

function row<T>(r: D1Result<T>): T | null {
  return (r.results && r.results[0]) || null;
}
function rows<T>(r: D1Result<T>): T[] {
  return (r.results as T[]) || [];
}

export async function getUser(env: Env, id: string): Promise<UserRow | null> {
  const r = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();
  return r || null;
}

export async function getUserBySlug(env: Env, slug: string): Promise<UserRow | null> {
  const r = await env.DB.prepare("SELECT * FROM users WHERE remit_slug = ?").bind(slug).first<UserRow>();
  return r || null;
}

export async function upsertUser(env: Env, id: string, fields: Partial<UserRow> & { tg_user_id: number; username?: string | null }): Promise<void> {
  const existing = await getUser(env, id);
  const now = Date.now();
  if (existing) {
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) continue;
      sets.push(`${k} = ?`);
      vals.push(v);
    }
    if (sets.length === 0) return;
    sets.push("updated_at = ?");
    vals.push(now);
    vals.push(id);
    await env.DB.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
  } else {
    await env.DB.prepare(
      "INSERT INTO users (id, tg_user_id, username, wallet_address, pass_name, pass_verified, pass_id, remit_slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(
        id,
        fields.tg_user_id,
        fields.username ?? null,
        fields.wallet_address ?? null,
        fields.pass_name ?? null,
        fields.pass_verified ?? 0,
        fields.pass_id ?? null,
        fields.remit_slug ?? null,
        now,
        now
      )
      .run();
  }
}

export async function createInvoiceRow(env: Env, inv: Omit<InvoiceRow, "created_at" | "paid_at" | "pay_tx" | "payer_address" | "status"> & { status?: string }): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO invoices (id, on_chain_id, creator_id, creator_address, amount, currency, description, client_name, slug, status, create_tx, pay_tx, payer_address, paid_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)`
  )
    .bind(
      inv.id,
      inv.on_chain_id,
      inv.creator_id,
      inv.creator_address,
      inv.amount,
      inv.currency,
      inv.description,
      inv.client_name ?? null,
      inv.slug,
      inv.status ?? "pending",
      inv.create_tx ?? null,
      Date.now()
    )
    .run();
}

export async function getInvoiceRow(env: Env, id: string): Promise<InvoiceRow | null> {
  const r = await env.DB.prepare("SELECT * FROM invoices WHERE id = ?").bind(id).first<InvoiceRow>();
  return r || null;
}

export async function getInvoiceBySlug(env: Env, slug: string): Promise<InvoiceRow | null> {
  const r = await env.DB.prepare("SELECT * FROM invoices WHERE slug = ?").bind(slug).first<InvoiceRow>();
  return r || null;
}

export async function getInvoiceByOnChainId(env: Env, onChainId: number): Promise<InvoiceRow | null> {
  const r = await env.DB.prepare("SELECT * FROM invoices WHERE on_chain_id = ?").bind(onChainId).first<InvoiceRow>();
  return r || null;
}

export async function listInvoicesByCreator(env: Env, creatorId: string, limit = 20): Promise<InvoiceRow[]> {
  const r = await env.DB.prepare("SELECT * FROM invoices WHERE creator_id = ? ORDER BY created_at DESC LIMIT ?")
    .bind(creatorId, limit)
    .all<InvoiceRow>();
  return rows(r);
}

export async function markInvoicePaid(env: Env, id: string, payTx: string, payer: string): Promise<void> {
  await env.DB.prepare("UPDATE invoices SET status = 'paid', pay_tx = ?, payer_address = ?, paid_at = ? WHERE id = ?")
    .bind(payTx, payer, Date.now(), id)
    .run();
}

/** Set an invoice's status (pending|paid|cancelled). Used by /cancel-invoice. */
export async function setInvoiceStatus(env: Env, id: string, status: string): Promise<void> {
  await env.DB.prepare("UPDATE invoices SET status = ? WHERE id = ?").bind(status, id).run();
}

export async function insertPayment(env: Env, p: Omit<PaymentRow, "paid_at">): Promise<void> {
  await env.DB.prepare("INSERT OR REPLACE INTO payments (invoice_id, on_chain_id, tx_hash, payer, amount, paid_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(p.invoice_id, p.on_chain_id, p.tx_hash, p.payer, p.amount, Date.now())
    .run();
}

export async function getUserByIdentifier(env: Env, identifier: string): Promise<UserRow | null> {
  // identifier can be a remit slug or a wallet address
  const bySlug = await getUserBySlug(env, identifier);
  if (bySlug) return bySlug;
  const r = await env.DB.prepare("SELECT * FROM users WHERE lower(wallet_address) = lower(?)")
    .bind(identifier)
    .first<UserRow>();
  return r || null;
}

export interface EarningsStats {
  totalInvoices: number;
  paidInvoices: number;
  pendingInvoices: number;
  totalEarned: number;
  pendingAmount: number;
  thisMonthEarned: number;
  thisMonthCount: number;
}

export async function earningsStats(env: Env, creatorId: string): Promise<EarningsStats> {
  const all = await listInvoicesByCreator(env, creatorId, 1000);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  let totalEarned = 0,
    pendingAmount = 0,
    paid = 0,
    pending = 0,
    monthEarned = 0,
    monthCount = 0;
  for (const inv of all) {
    if (inv.status === "paid") {
      paid++;
      totalEarned += inv.amount;
      if (inv.paid_at && inv.paid_at >= monthStart) {
        monthEarned += inv.amount;
        monthCount++;
      }
    } else if (inv.status === "pending") {
      pending++;
      pendingAmount += inv.amount;
    }
  }
  return {
    totalInvoices: all.length,
    paidInvoices: paid,
    pendingInvoices: pending,
    totalEarned,
    pendingAmount,
    thisMonthEarned: monthEarned,
    thisMonthCount: monthCount,
  };
}

// ---- convenience wrappers used by the Telegram channel ----

export async function getOrCreateUser(
  env: Env,
  id: string,
  tgUserId: number,
  username: string | null
): Promise<UserRow> {
  const existing = await getUser(env, id);
  if (existing) {
    if (username && existing.username !== username) {
      await upsertUser(env, id, { tg_user_id: tgUserId, username });
      existing.username = username;
    }
    return existing;
  }
  await upsertUser(env, id, { tg_user_id: tgUserId, username });
  return (await getUser(env, id)) as UserRow;
}

export async function getUserByTgId(env: Env, tgUserId: number): Promise<UserRow | null> {
  const r = await env.DB.prepare("SELECT * FROM users WHERE tg_user_id = ?")
    .bind(tgUserId)
    .first<UserRow>();
  return r || null;
}

export async function updateUserWallet(env: Env, id: string, address: string, slug: string): Promise<void> {
  await upsertUser(env, id, { wallet_address: address, remit_slug: slug } as any);
}

export async function setVerified(env: Env, id: string, name: string, attestationTx: string): Promise<void> {
  await upsertUser(env, id, { pass_name: name, pass_verified: 1, pass_id: attestationTx } as any);
}

export async function setRemitSlug(env: Env, id: string, slug: string): Promise<void> {
  await upsertUser(env, id, { remit_slug: slug } as any);
}

export const insertInvoice = createInvoiceRow;
export const getInvoice = getInvoiceRow;
export const markPaid = markInvoicePaid;

export async function sumPaidThisMonth(env: Env, creatorId: string): Promise<{ total: number; count: number }> {
  const s = await earningsStats(env, creatorId);
  return { total: s.thisMonthEarned, count: s.thisMonthCount };
}

export async function unpaidSummary(env: Env, creatorId: string): Promise<{ count: number; total: number }> {
  const s = await earningsStats(env, creatorId);
  return { count: s.pendingInvoices, total: s.pendingAmount };
}

export async function recentPaidPayments(env: Env, creatorId: string, limit = 5): Promise<InvoiceRow[]> {
  const r = await env.DB.prepare(
    "SELECT * FROM invoices WHERE creator_id = ? AND status = 'paid' ORDER BY paid_at DESC LIMIT ?"
  )
    .bind(creatorId, limit)
    .all<InvoiceRow>();
  return rows(r);
}
