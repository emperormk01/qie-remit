/**
 * Auto payment detection — polls the QIE explorer API for incoming
 * transactions matching pending invoices.
 *
 * No payer action needed: the sender just transfers the exact QIE amount
 * to the merchant's address (shown on the invoice page), and this module
 * detects it automatically.
 *
 * Sources:
 *   GET https://testnet.qie.digital/api/v2/addresses/{addr}/transactions
 *     Returns: items[].{hash, value (wei string), from.hash, to.hash,
 *                       timestamp (ISO), status, result}
 *
 * Matching rules (FIFO to avoid double-crediting):
 *   1. tx.to == invoice.creator_address  (case-insensitive)
 *   2. tx.value == parseEther(invoice.amount)  (exact wei match)
 *   3. tx.timestamp >= invoice.created_at
 *   4. tx.status == "ok" && tx.result == "success"
 *   5. tx.hash NOT already in the payments table (dedup)
 *   6. When multiple pending invoices share (creator, amount), the OLDEST
 *      gets credited first — a single tx settles exactly one invoice.
 */
import type { Env } from "./types";
import type { InvoiceRow } from "./db";
import { markInvoicePaid, insertPayment } from "./db";
import { notifyCreatorPaid } from "./telegram";

const EXPLORER_BASE = "https://testnet.qie.digital/api/v2";

interface ExplorerTx {
  hash: string;
  value: string; // wei
  from: { hash: string };
  to: { hash: string } | null;
  timestamp: string; // ISO
  status: string;
  result: string;
}

/** Fetch recent incoming transactions for an address (most-recent-first). */
async function fetchIncomingTxs(address: string, limit = 25): Promise<ExplorerTx[]> {
  const url = `${EXPLORER_BASE}/addresses/${address}/transactions?filter=to`;
  try {
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) return [];
    const d: any = await r.json();
    return (d.items || []).slice(0, limit) as ExplorerTx[];
  } catch {
    return [];
  }
}

/** Check if a tx hash is already recorded in the payments table. */
async function txAlreadyCredited(env: Env, txHash: string): Promise<boolean> {
  const r = await env.DB.prepare("SELECT 1 FROM payments WHERE tx_hash = ? LIMIT 1")
    .bind(txHash)
    .first();
  return !!r;
}

/**
 * Main detection pass. Fetches all pending invoices, groups by creator,
 * polls the explorer for each creator's recent incoming txs, and credits
 * matching invoices (FIFO). Returns the count of newly-paid invoices.
 */
export async function pollPendingPayments(env: Env, ctx?: ExecutionContext): Promise<number> {
  // Fetch all pending invoices, oldest first (FIFO credit order).
  const r = await env.DB.prepare(
    "SELECT * FROM invoices WHERE status = 'pending' ORDER BY created_at ASC LIMIT 100"
  ).all<InvoiceRow>();
  const pending = r.results as InvoiceRow[] || [];
  if (pending.length === 0) return 0;

  // Group by creator_address so we make one explorer call per merchant.
  const byCreator = new Map<string, InvoiceRow[]>();
  for (const inv of pending) {
    const key = inv.creator_address.toLowerCase();
    const arr = byCreator.get(key) || [];
    arr.push(inv);
    byCreator.set(key, arr);
  }

  let credited = 0;
  for (const [creatorAddr, invoices] of byCreator) {
    const txs = await fetchIncomingTxs(creatorAddr);
    if (txs.length === 0) continue;

    // Track which txs we've already matched in this pass (avoid one tx
    // crediting two invoices of the same amount).
    const usedTxHashes = new Set<string>();

    for (const inv of invoices) {
      // Parse expected wei once.
      let expectedWei: bigint;
      try {
        const { parseEther } = await import("viem");
        expectedWei = parseEther(String(inv.amount));
      } catch { continue; }

      const invCreatedMs = inv.created_at;

      for (const tx of txs) {
        if (usedTxHashes.has(tx.hash)) continue;
        if (!tx.to) continue;
        if (tx.to.hash.toLowerCase() !== creatorAddr) continue;
        if (tx.status !== "ok" || tx.result !== "success") continue;

        // Value match (exact wei).
        let txValue: bigint;
        try { txValue = BigInt(tx.value); } catch { continue; }
        if (txValue !== expectedWei) continue;

        // Time window: tx must be at or after invoice creation.
        const txMs = new Date(tx.timestamp).getTime();
        if (txMs < invCreatedMs) continue;

        // Dedup: not already credited to any invoice.
        if (await txAlreadyCredited(env, tx.hash)) continue;

        // Match found — credit this invoice.
        const payer = tx.from.hash;
        try {
          await markInvoicePaid(env, inv.id, tx.hash, payer);
          await insertPayment(env, {
            invoice_id: inv.id,
            on_chain_id: inv.on_chain_id,
            tx_hash: tx.hash,
            payer,
            amount: inv.amount,
          });
          credited++;
          usedTxHashes.add(tx.hash);
          // Notify the freelancer (fire-and-forget). ctx.waitUntil keeps the
          // handler alive past the response so the TG message + PDF upload land.
          const notify = () => notifyCreatorPaid(env, inv.id).catch((e) => console.error("notify", e));
          if (ctx) ctx.waitUntil(notify());
          else notify();
        } catch (e) {
          console.error("poll credit failed:", inv.id, e);
        }
        break; // this invoice is settled; move to next pending invoice
      }
    }
  }
  return credited;
}

/**
 * On-demand check for a single invoice (used by the /status endpoint so
 * the invoice page can poll and detect payment near-instantly without
 * waiting for cron). Returns true if the invoice was just credited.
 */
export async function checkSingleInvoice(env: Env, inv: InvoiceRow, ctx?: ExecutionContext): Promise<boolean> {
  if (inv.status === "paid") return false;

  let expectedWei: bigint;
  try {
    const { parseEther } = await import("viem");
    expectedWei = parseEther(String(inv.amount));
  } catch { return false; }

  const txs = await fetchIncomingTxs(inv.creator_address, 25);
  const creatorAddr = inv.creator_address.toLowerCase();

  for (const tx of txs) {
    if (!tx.to) continue;
    if (tx.to.hash.toLowerCase() !== creatorAddr) continue;
    if (tx.status !== "ok" || tx.result !== "success") continue;

    let txValue: bigint;
    try { txValue = BigInt(tx.value); } catch { continue; }
    if (txValue !== expectedWei) continue;

    const txMs = new Date(tx.timestamp).getTime();
    if (txMs < inv.created_at) continue;

    if (await txAlreadyCredited(env, tx.hash)) continue;

    // Match — credit it.
    const payer = tx.from.hash;
    try {
      await markInvoicePaid(env, inv.id, tx.hash, payer);
      await insertPayment(env, {
        invoice_id: inv.id,
        on_chain_id: inv.on_chain_id,
        tx_hash: tx.hash,
        payer,
        amount: inv.amount,
      });
      const notify = () => notifyCreatorPaid(env, inv.id).catch((e) => console.error("notify", e));
      if (ctx) ctx.waitUntil(notify());
      else notify();
      return true;
    } catch (e) {
      console.error("single check credit failed:", inv.id, e);
      return false;
    }
  }
  return false;
}
