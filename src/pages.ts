import type { Contracts } from "./chain";
import type { InvoiceRow, UserRow } from "./db";
import { getQiePrice, usdEquiv as usdEquivFn } from "./price";

const QIE_CHAIN = {
  chainId: "0x7bf", // 1983
  chainName: "QIE Testnet",
  rpcUrls: ["https://rpc1testnet.qie.digital/"],
  blockExplorerUrls: ["https://testnet.qie.digital/"],
  nativeCurrency: { name: "QIE", symbol: "QIE", decimals: 18 },
};

function shell(title: string, body: string, extraHead = ""): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title} — QIE Remit</title>
<meta name="description" content="QIE Remit — international invoices paid instantly with native QIE on QIE Blockchain." />
${extraHead}
<style>
  :root { --bg:#ffffff; --card:#f8f9fb; --line:#e4e7ec; --fg:#101725; --mut:#667085; --acc:#2563eb; --green:#059669; --amber:#d97706; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; }
  .wrap { max-width:560px; margin:0 auto; padding:24px 18px 64px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:22px; margin:14px 0; }
  .brand { display:flex; align-items:center; gap:10px; font-weight:700; font-size:18px; }
  .mut { color:var(--mut); font-size:13px; }
  h1 { font-size:22px; margin:6px 0 2px; }
  .amt { font-size:34px; font-weight:800; letter-spacing:-1px; }
  .amt small { font-size:15px; color:var(--mut); font-weight:600; }
  .row { display:flex; justify-content:space-between; padding:10px 0; border-bottom:1px dashed var(--line); font-size:14px; }
  .row:last-child { border-bottom:none; }
  .row .k { color:var(--mut); }
  .badge { display:inline-flex; align-items:center; gap:6px; background:rgba(52,211,153,.12); color:var(--green); border:1px solid rgba(52,211,153,.3); padding:4px 10px; border-radius:999px; font-size:12px; font-weight:700; }
  .badge.unverified { background:rgba(139,151,167,.1); color:var(--mut); border-color:var(--line); }
  .btn { display:block; width:100%; padding:14px; border-radius:12px; border:none; font-size:15px; font-weight:700; cursor:pointer; margin:8px 0; }
  .btn.primary { background:linear-gradient(135deg,#6ea8fe,#a78bfa); color:#ffffff; }
  .btn.ghost { background:var(--line); color:var(--fg); }
  .btn:disabled { opacity:.5; cursor:not-allowed; }
  .status { font-size:13px; color:var(--mut); min-height:20px; text-align:center; margin-top:6px; }
  .ok { color:var(--green); } .err { color:#fb7185; }
  .mono { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; word-break:break-all; }
  a { color:var(--acc); }
  .pill { display:inline-block; background:var(--line); color:var(--mut); padding:2px 8px; border-radius:6px; font-size:11px; }
  .paid-banner { background:rgba(52,211,153,.1); border:1px solid rgba(52,211,153,.3); color:var(--green); border-radius:12px; padding:14px; text-align:center; font-weight:700; margin:14px 0; }
</style>
</head>
<body>
<div class="wrap">
  <div class="brand">QIE Remit</div>
${body}
</div>
</body>
</html>`;
}

export async function invoicePage(inv: InvoiceRow, creator: UserRow | null, contracts: Contracts, origin: string): Promise<string> {
  const verified = creator?.pass_verified === 1;
  const creatorName = creator?.pass_name || creator?.username || "Freelancer";
  const price = await getQiePrice();
  const usdStr = price.usd != null ? usdEquivFn(inv.amount, price) : null;
  const cfg = {
    invoiceId: inv.id,
    slug: inv.slug,
    onChainId: inv.on_chain_id,
    amount: inv.amount,
    currency: inv.currency,
    description: inv.description,
    clientName: inv.client_name,
    creatorAddress: inv.creator_address,
    creatorName,
    verified,
    chain: QIE_CHAIN,
    explorer: "https://testnet.qie.digital",
    confirmUrl: `${origin}/api/invoice/${inv.slug}/confirm`,
    receiptUrl: `${origin}/receipt/${inv.id}`,
  };
  const body = `
  <div class="card">
    <span class="mut">Invoice ${inv.id}</span>
    <h1>${escapeHtml(inv.description || "Invoice")}</h1>
    <div class="amt">${inv.amount} <small>${inv.currency}</small></div>
    ${usdStr ? `<div class="mut" style="margin-top:4px;font-size:14px;">${usdStr}</div>` : ""}
    <div style="margin-top:14px;">
      ${verified ? `<span class="badge">Identity attested on-chain</span>` : `<span class="badge unverified">Unverified merchant</span>`}
      <span class="pill">QIE Testnet</span>
    </div>
  </div>
  <div class="card">
    <div class="row"><span class="k">Merchant</span><span>${escapeHtml(creatorName)}</span></div>
    <div class="row"><span class="k">Receive address</span><span class="mono">${shortAddr(inv.creator_address)}</span></div>
    ${inv.client_name ? `<div class="row"><span class="k">Billed to</span><span>${escapeHtml(inv.client_name)}</span></div>` : ""}
    <div class="row"><span class="k">Network</span><span>QIE Testnet (1983)</span></div>
    <div class="row"><span class="k">Token</span><span>${inv.currency} · 18 decimals (native QIE)</span></div>
  </div>
${inv.status === "paid" ? `
  <div class="card" style="text-align:center;">
    <div class="paid-banner" style="margin:0;">PAID · settled on-chain</div>
    <p class="mut" style="margin:12px 0;">This invoice has been paid.</p>
    <a class="btn primary" style="text-decoration:none;text-align:center;" href="${origin}/receipt/${inv.id}">View receipt</a>
  </div>` : `
  <div class="card">
    <div id="paidBanner" style="display:none" class="paid-banner">Payment confirmed on-chain. Opening receipt…</div>
    <div class="row" style="border-bottom:none;padding-bottom:6px;"><span class="k">Send exactly</span><span class="mono" style="font-size:16px;font-weight:700;color:var(--fg)">${inv.amount} ${inv.currency}</span></div>
    ${usdStr ? `<div class="mut" style="margin:2px 0;">${usdStr}</div>` : ""}
    <div class="mut" style="margin:2px 0 14px;">Native QIE on QIE Testnet (chain ID 1983). Send the exact amount — mismatched amounts won't verify.</div>
    <div class="row" style="border-bottom:none;padding-bottom:6px;"><span class="k">To address</span><span class="mono" style="font-size:13px;word-break:break-all">${inv.creator_address}</span></div>
    <button id="copy" class="btn ghost">Copy address</button>
    <div id="autoDetect" style="margin-top:16px;padding:14px;border:1px solid var(--line);border-radius:12px;text-align:center;">
      <div style="font-size:14px;font-weight:700;color:var(--green);">⏳ Listening for your payment…</div>
      <div class="mut" style="margin-top:6px;font-size:12px;">Send ${inv.amount} QIE to the address above from any wallet. We'll detect it automatically — no need to paste anything.</div>
      <div id="pollStatus" class="mut" style="margin-top:8px;font-size:11px;"></div>
    </div>
    <details style="margin-top:14px;">
      <summary class="mut" style="cursor:pointer;font-size:13px;">Already sent? Paste tx hash manually</summary>
      <div style="margin-top:10px;">
        <input id="txhash" type="text" placeholder="0x…" class="mono" style="width:100%;padding:12px;margin:8px 0;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--fg);font-size:13px;" />
        <button id="confirm" class="btn primary">Verify payment</button>
      </div>
    </details>
    <div id="status" class="status"></div>
  </div>`}
  <script type="application/json" id="cfg">${JSON.stringify(cfg)}</script>
  <script type="module">
    const cfg = JSON.parse(document.getElementById('cfg').textContent);
    const $ = id => document.getElementById(id);
    const setStatus = (m, c) => { const s=$('status'); s.textContent=m; s.className='status '+(c||''); };
    function err(e){ const m = e?.reason || e?.shortMessage || e?.message || String(e); return m.replace('execution reverted: ',''); }
    $('copy').onclick = () => {
      navigator.clipboard.writeText(cfg.creatorAddress).then(
        () => setStatus('Address copied!', 'ok'),
        () => setStatus('Copy failed — long-press to select manually.', 'err')
      );
    };
    setStatus('Listening for your payment…');
    // Auto-poll: check /status every 5s, auto-redirect when paid
    let pollCount = 0;
    const statusUrl = cfg.confirmUrl.replace('/confirm', '/status');
    async function autoPoll() {
      try {
        const r = await fetch(statusUrl, { headers: { 'Accept': 'application/json' } });
        const d = await r.json();
        if (d.status === 'paid' || d.paid === true) {
          $('paidBanner').style.display = '';
          $('autoDetect').style.display = 'none';
          setStatus('Payment confirmed on-chain! Opening receipt…', 'ok');
          setTimeout(() => location.href = cfg.receiptUrl, 1200);
          return;
        }
        pollCount++;
        const ps = $('pollStatus');
        if (ps) ps.textContent = 'Checking… (' + pollCount + ')';
      } catch (e) { /* transient */ }
      setTimeout(autoPoll, 5000);
    }
    autoPoll();
    // Manual fallback
    const confirmBtn = $('confirm');
    const txHashInput = $('txhash');
    if (confirmBtn) {
      confirmBtn.onclick = async () => {
        const txHash = txHashInput.value.trim();
        if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
          setStatus('Paste a valid 0x… transaction hash (64 hex chars).', 'err');
          return;
        }
        setStatus('Verifying on-chain…');
        try {
          const r = await fetch(cfg.confirmUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ txHash }),
          });
          const cd = await r.json();
          if (cd.paid === true || (cd.ok && cd.paid)) {
            $('paidBanner').style.display = '';
            $('autoDetect').style.display = 'none';
            setStatus('Payment confirmed. Opening receipt…', 'ok');
            setTimeout(() => location.href = cfg.receiptUrl, 1200);
          } else {
            setStatus(cd.error || 'Verification failed — check the tx hash and that you sent the exact amount to the merchant address.', 'err');
          }
        } catch (e) { setStatus(err(e), 'err'); }
      };
    }
    setStatus('');
  </script>`;
  return shell(`Invoice ${inv.id}`, body);
}

export function remitPage(creator: UserRow): string {
  const verified = creator.pass_verified === 1;
  const name = creator.pass_name || creator.username || "Merchant";
  const addr = creator.wallet_address || "";
  const username = creator.username || "";
  const contactBtn = username
    ? `<a class="btn primary" style="text-decoration:none;text-align:center;" href="https://t.me/${escapeHtml(username)}" target="_blank" rel="noopener">Contact @${escapeHtml(username)} on Telegram</a>`
    : `<p class="mut" style="text-align:center;">This merchant hasn't shared a Telegram handle.</p>`;
  const body = `
  <div class="card" style="text-align:center;">
    <div class="amt" style="font-size:28px;">Pay ${escapeHtml(name)}</div>
    <div style="margin-top:8px;">
      ${verified ? `<span class="badge">Identity attested on-chain</span>` : `<span class="badge unverified">Unverified</span>`}
    </div>
    <div class="mut mono" style="margin-top:10px;">${shortAddr(addr)}</div>
  </div>
  <div class="card">
    <p class="mut">This merchant accepts native QIE payments on QIE Blockchain. To pay a specific invoice, open the invoice link they sent you.</p>
    ${contactBtn}
  </div>`;
  return shell(`Pay ${name}`, body);
}

export async function receiptPage(inv: InvoiceRow, creator: UserRow | null): Promise<string> {
  const paid = inv.status === "paid";
  const date = inv.paid_at ? new Date(inv.paid_at).toUTCString() : "—";
  const price = paid ? await getQiePrice() : null;
  const usdStr = price && price.usd != null ? usdEquivFn(inv.amount, price) : null;
  const body = `
  <div class="card">
    <h1 style="margin-top:0;">Invoice ${inv.id}</h1>
    <div class="amt">${inv.amount} <small>${inv.currency}</small></div>
    ${paid ? `<div class="paid-banner">PAID</div>` : `<div class="status err">UNPAID</div>`}
    ${paid && usdStr ? `<div class="mut" style="margin-top:6px;">${usdStr}</div>` : ""}
  </div>
  <div class="card">
    <div class="row"><span class="k">Status</span><span>${paid ? "Paid" : "Pending"}</span></div>
    <div class="row"><span class="k">Description</span><span>${escapeHtml(inv.description || "—")}</span></div>
    <div class="row"><span class="k">Merchant</span><span>${escapeHtml(creator?.pass_name || creator?.username || "—")}</span></div>
    <div class="row"><span class="k">Merchant address</span><span class="mono">${shortAddr(inv.creator_address)}</span></div>
    ${inv.payer_address ? `<div class="row"><span class="k">Paid by</span><span class="mono">${shortAddr(inv.payer_address)}</span></div>` : ""}
    <div class="row"><span class="k">Paid at</span><span>${date}</span></div>
    ${inv.pay_tx ? `<div class="row"><span class="k">Tx hash</span><span class="mono"><a href="https://testnet.qie.digital/tx/${inv.pay_tx}" target="_blank">${shortAddr(inv.pay_tx)}</a></span></div>` : ""}
    <div class="row"><span class="k">On-chain invoice</span><span class="mono">#${inv.on_chain_id}</span></div>
  </div>
  <button class="btn ghost" onclick="window.print()">Print / Save as PDF</button>
  <p class="mut" style="text-align:center;margin-top:18px;">Settled on QIE Blockchain · Identity attested on-chain</p>`;
  return shell(`Receipt ${inv.id}`, body);
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
function shortAddr(a: string | null): string {
  if (!a) return "—";
  return a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a;
}
