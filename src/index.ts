import type { Env } from "./types";
import { handleTelegramWebhook, setTelegramWebhook, registerTelegramCommands, notifyCreatorPaid } from "./telegram";
import { invoicePage, remitPage, receiptPage } from "./pages";
import {
  getInvoiceBySlug, getInvoice, markPaid, getUserBySlug, getUser,
} from "./db";
import {
  getContracts, getInvoiceOnChain, verifyDirectTransferTx, fundPayer, QIE_TESTNET, chainExplorer,
} from "./chain";
import { pollPendingPayments, checkSingleInvoice } from "./poll";

const VERSION = "0.1.0";

const cors: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: cors });
}
function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", ...cors } });
}
function requireAuth(env: Env, req: Request): boolean {
  if (!env.API_KEY) return false;
  return req.headers.get("Authorization") === `Bearer ${env.API_KEY}`;
}

function notFound(title: string, detail: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;background:#ffffff;color:#101725;font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center}.c{max-width:420px;padding:32px;text-align:center}.b{display:inline-block;background:#f8f9fb;border:1px solid #e4e7ec;border-radius:14px;padding:24px}.x{color:#2563eb;font-weight:700}.m{color:#667085;margin-top:8px}</style></head><body><div class="c"><div class="b"><div class="x">QIE Remit</div><h2>${title}</h2><p class="m">${detail}</p></div></div></body></html>`;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const origin = `${url.protocol}//${url.host}`;

    if (method === "OPTIONS") return new Response(null, { headers: cors });

    try {
      // ---- health / info ----
      if (path === "/" && method === "GET") {
        return json({
          name: "QIE Remit", version: VERSION, status: "online",
          chain: { id: QIE_TESTNET.id, name: QIE_TESTNET.name, rpc: QIE_TESTNET.rpcUrls.default.http[0], explorer: chainExplorer() },
          tagline: "Send international invoices. Get paid instantly in native QIE. Identity attested on-chain. Settlement on-chain.",
          endpoints: {
            telegram: "POST /telegram",
            invoice: "GET /invoice/:slug",
            pay: "GET /pay/:slug",
            receipt: "GET /receipt/:id",
            status: "GET /api/invoice/:slug/status",
            confirm: "POST /api/invoice/:slug/confirm",
            faucet: "POST /api/faucet?address=0x...",
            deploy: "POST /admin/deploy",
            setupTelegram: "POST /admin/setup-telegram",
          },
        });
      }
      if (path === "/health") return json({ ok: true, t: Date.now() });

      // ---- Telegram webhook ----
      if (path === "/telegram" && method === "POST") {
        return handleTelegramWebhook(request, env, ctx, origin);
      }

      // ---- payment page ----
      if (path.startsWith("/invoice/") && method === "GET") {
        const slug = decodeURIComponent(path.slice("/invoice/".length));
        const inv = await getInvoiceBySlug(env, slug);
        if (!inv) return html(notFound("Invoice not found", "This invoice link is invalid or has been removed."), 404);
        const creator = await getUser(env, inv.creator_id);
        const c = await getContracts(env);
        if (!c) return html(notFound("Not initialized", "Contracts are not deployed yet. An admin must run /deploy."));
        return html(await invoicePage(inv, creator, c, origin));
      }

      // ---- remit (paypal.me-style) landing ----
      if (path.startsWith("/pay/") && method === "GET") {
        const slug = decodeURIComponent(path.slice("/pay/".length));
        const creator = await getUserBySlug(env, slug);
        if (!creator || !creator.wallet_address) return html(notFound("Merchant not found", "No merchant owns this pay link."), 404);
        return html(remitPage(creator));
      }

      // ---- receipt page ----
      if (path.startsWith("/receipt/") && method === "GET") {
        const id = decodeURIComponent(path.slice("/receipt/".length));
        const inv = await getInvoice(env, id);
        if (!inv) return html(notFound("Receipt not found", "No invoice with that ID."), 404);
        const creator = await getUser(env, inv.creator_id);
        return html(await receiptPage(inv, creator));
      }

      // ---- API: invoice status (on-chain + D1) ----
      if (path.startsWith("/api/invoice/") && path.endsWith("/status") && method === "GET") {
        const slug = decodeURIComponent(path.slice("/api/invoice/".length, -"/status".length));
        const inv = await getInvoiceBySlug(env, slug);
        if (!inv) return json({ error: "not found" }, 404);
        // Auto-detect: poll explorer for a matching direct transfer.
        // checkSingleInvoice credits the invoice + notifies if a match is found.
        const justPaid = await checkSingleInvoice(env, inv, ctx);
        // Re-read after potential update.
        const current = justPaid ? await getInvoiceBySlug(env, slug) : inv;
        if (!current) return json({ error: "not found" }, 404);
        return json({
          id: current.id, slug, status: current.status,
          amount: current.amount, currency: current.currency,
          onChainId: current.on_chain_id, payer: current.payer_address,
        });
      }

      // ---- API: confirm payment (called by the payment page after tx) ----
      if (path.startsWith("/api/invoice/") && path.endsWith("/confirm") && method === "POST") {
        const slug = decodeURIComponent(path.slice("/api/invoice/".length, -"/confirm".length));
        const inv = await getInvoiceBySlug(env, slug);
        if (!inv) return json({ error: "not found" }, 404);
        const body = await request.json().catch(() => ({})) as { txHash?: string };
        const txHash = (body.txHash || "").trim();
        if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) return json({ error: "invalid txHash" }, 400);
        if (inv.status === "paid") return json({ ok: true, paid: true, duplicate: true });
        const c = await getContracts(env);
        if (!c) return json({ error: "contracts not deployed" }, 503);
        const res = await verifyDirectTransferTx(env, inv.creator_address, inv.amount, txHash as `0x${string}`);
        if (!res.paid) return json({ ok: false, paid: false, error: res.reason || "tx does not settle this invoice" }, 400);
        await markPaid(env, inv.id, txHash, res.payer || "");
        ctx.waitUntil(notifyCreatorPaid(env, inv.id).catch((e) => console.error("notify", e)));
        return json({ ok: true, paid: true, payer: res.payer, receipt: `${origin}/receipt/${inv.id}` });
      }

      // ---- API: faucet (forward testnet QIE from operator to a payer for the demo) ----
      if (path === "/api/faucet" && method === "POST") {
        const body = await request.json().catch(() => ({})) as { address?: string; amount?: number };
        const addr = (body.address || "").trim();
        if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) return json({ error: "invalid address" }, 400);
        const amount = Number(body.amount) > 0 ? Number(body.amount) : 1;
        try {
          const res = await fundPayer(env, addr as `0x${string}`, amount);
          return json({ ok: true, sent: res.sent, txHash: res.txHash, explorer: `${chainExplorer()}/tx/${res.txHash}` });
        } catch (e: any) {
          return json({ error: e.message || String(e) }, 500);
        }
      }

      // ---- Admin (bearer auth) ----
      if (path.startsWith("/admin/")) {
        if (!requireAuth(env, request)) return json({ error: "Unauthorized" }, 401);
        if (path === "/admin/deploy" && method === "POST") {
          const { ensureOperator } = await import("./wallet");
          const op = await ensureOperator(env);
          const { deployContracts } = await import("./chain");
          const c = await deployContracts(env);
          return json({ ok: true, contracts: c, operator: op.address, note: "Fund operator with testnet QIE for gas: https://www.qie.digital/faucet" });
        }
        if (path === "/admin/setup-telegram" && method === "POST") {
          const webhook = await setTelegramWebhook(env, origin);
          const commands = await registerTelegramCommands(env);
          return json({ ok: true, webhook, commands, webhookUrl: `${origin}/telegram` });
        }
        if (path === "/admin/contracts" && method === "GET") {
          return json({ contracts: await getContracts(env) });
        }
        return json({ error: "not found" }, 404);
      }

      return json({ error: "not found", path }, 404);
    } catch (err) {
      console.error("Unhandled:", err);
      return json({ error: err instanceof Error ? err.message : "internal error" }, 500);
    }
  },

  // ---- Cron trigger: auto-detect pending payments every minute ----
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(pollPendingPayments(env, ctx).catch((e) => console.error("cron poll", e)));
  },
};
