import type { Env } from "./types";
import { markdownToTelegram } from "./markdown";
import { genId, genSlug, isValidAddress, checksumAddress } from "./utils";
import {
  getOrCreateUser, getUser, updateUserWallet, setVerified, setRemitSlug,
  insertInvoice, getInvoice, getInvoiceBySlug, listInvoicesByCreator,
  markPaid, getUserBySlug, unpaidSummary, sumPaidThisMonth, recentPaidPayments,
  setInvoiceStatus,
} from "./db";
import {
  getContracts, createInvoiceOnChain, attestIdentity,
  cancelInvoiceOnChain,
} from "./chain";
import { parseInvoice, analytics } from "./ai";
import { getQiePrice, usdEquiv } from "./price";
import { generateReceiptPdf, uploadPdfToTelegram } from "./receipt";

// Native QIE uses 18 decimals; amounts are human (QIE) and converted to wei in chain.ts.
const ORIGIN = "https://qie-remit.georgeo-qie.workers.dev"; // fallback only; request origin + PUBLIC_BASE_URL take precedence

// ---- Telegram types ----
interface TgUser { id: number; first_name: string; username?: string; }
interface TgMessage { message_id: number; from: TgUser; chat: { id: number; type: string }; text?: string; }
interface TgCallback { id: string; from: TgUser; message?: TgMessage; data?: string; }
interface TgUpdate { update_id: number; message?: TgMessage; callback_query?: TgCallback; }

const BOT_COMMANDS = [
  { command: "start", description: "Onboard & open the main menu" },
  { command: "wallet", description: "Set your QIE receive address (0x…)" },
  { command: "verify", description: "Verify identity on QIE (on-chain attestation)" },
  { command: "invoice", description: "Create an invoice (AI parses your text)" },
  { command: "invoices", description: "List your invoices" },
  { command: "stats", description: "Earnings & unpaid summary (AI)" },
  { command: "remitlink", description: "Set your pay-me link slug" },
  { command: "cancel-invoice", description: "Cancel a pending invoice: /cancel-invoice INV-XXXX" },
  { command: "receipt", description: "Regenerate a receipt PDF: /receipt INV-…" },
  { command: "status", description: "Show your wallet, identity & link" },
  { command: "help", description: "List all commands" },
];

function parseCommand(text: string): { command: string; args: string } | null {
  const m = text.match(/^\/(\w+)(?:@\w+)?(?:\s+(.*))?$/);
  return m ? { command: m[1].toLowerCase(), args: m[2]?.trim() || "" } : null;
}

async function tgApi(env: Env, method: string, body: Record<string, unknown>): Promise<any> {
  if (!env.TELEGRAM_BOT_TOKEN) return null;
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return r.json();
}

async function sendText(env: Env, chatId: number, text: string, replyMarkup?: Record<string, unknown>): Promise<any> {
  const chunks = text.length <= 4000 ? [text] : text.match(/[\s\S]{1,4000}/g) || [text];
  let last: any = null;
  for (const chunk of chunks) {
    const isLast = chunk === chunks[chunks.length - 1];
    const body: Record<string, unknown> = { chat_id: chatId, text: markdownToTelegram(chunk), parse_mode: "MarkdownV2", disable_web_page_preview: true };
    if (replyMarkup && isLast) body.reply_markup = replyMarkup;
    let res = await tgApi(env, "sendMessage", body);
    if (!res?.ok) { delete (body as any).parse_mode; (body as any).text = chunk; res = await tgApi(env, "sendMessage", body); }
    if (res?.ok) last = res;
  }
  return last;
}

async function answerCallback(env: Env, id: string, text?: string): Promise<void> {
  const body: Record<string, unknown> = { callback_query_id: id };
  if (text) body.text = text;
  await tgApi(env, "answerCallbackQuery", body);
}

// Telegram's typing indicator auto-expires after ~5s. Re-fire it on a 4s
// interval while `fn` runs so the indicator stays live for long AI calls
// (invoice parsing, earnings analytics). Best-effort: never rejects.
async function sendTyping(env: Env, chatId: number): Promise<void> {
  await tgApi(env, "sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
}

async function withTyping<T>(env: Env, chatId: number, fn: () => Promise<T>): Promise<T> {
  await sendTyping(env, chatId);
  const timer = setInterval(() => { sendTyping(env, chatId); }, 4000);
  try {
    return await fn();
  } finally {
    clearInterval(timer);
  }
}

function mainKeyboard(): Record<string, unknown> {
  return { inline_keyboard: [
    [{ text: "Set Wallet", callback_data: "act:wallet" }, { text: "Verify Identity", callback_data: "act:verify" }],
    [{ text: "New Invoice", callback_data: "act:invoice" }, { text: "My Invoices", callback_data: "act:invoices" }],
    [{ text: "Earnings Stats", callback_data: "act:stats" }, { text: "My Pay Link", callback_data: "act:remit" }],
  ]};
}

// ---- wizard state (CONFIG KV, 10 min TTL) ----
async function setWizard(env: Env, userId: string, step: string): Promise<void> {
  await env.CONFIG.put(`wizard:${userId}`, step, { expirationTtl: 600 });
}
async function getWizard(env: Env, userId: string): Promise<string | null> {
  return env.CONFIG.get(`wizard:${userId}`);
}
async function clearWizard(env: Env, userId: string): Promise<void> {
  await env.CONFIG.delete(`wizard:${userId}`);
}

function originFor(env: Env, origin?: string): string {
  // Prefer the actual host the webhook was called on (works on workers.dev + custom domains),
  // then an explicit PUBLIC_BASE_URL override, then the constant fallback.
  return origin || env.PUBLIC_BASE_URL || ORIGIN;
}

// ---- main message handler ----
async function handleMessage(env: Env, msg: TgMessage, origin: string): Promise<void> {
  if (!msg.text) return;
  const chatId = msg.chat.id;
  const userId = `telegram:${msg.from.id}`;
  const text = msg.text;
  const user = await getOrCreateUser(env, userId, msg.from.id, msg.from.username || null);

  // wizard input (awaiting name for verify, or text for invoice)
  const step = await getWizard(env, userId);
  if (step) {
    if (text.startsWith("/cancel")) { await clearWizard(env, userId); await sendText(env, chatId, "Cancelled."); return; }
    if (step === "verify_name") { await clearWizard(env, userId); await doVerify(env, chatId, user, text, origin); return; }
    if (step === "invoice_text") { await clearWizard(env, userId); await doInvoice(env, chatId, user, text, origin); return; }
    if (step === "wallet_addr") { await clearWizard(env, userId); await doWallet(env, chatId, user, text, origin); return; }
    if (step === "remit_slug") { await clearWizard(env, userId); await doRemit(env, chatId, user, text, origin); return; }
  }

  const cmd = parseCommand(text);
  if (!cmd) { await sendText(env, chatId, "Send a command — try /start or /help.", mainKeyboard()); return; }

  switch (cmd.command) {
    case "start": return onStart(env, chatId, user, origin);
    case "help": return sendText(env, chatId, "*QIE Remit Commands*\n" + BOT_COMMANDS.map(c => `/${c.command} — ${c.description}`).join("\n"));
    case "wallet": {
      if (cmd.args) return doWallet(env, chatId, user, cmd.args, origin);
      if (user.wallet_address) {
        const slug = user.remit_slug || "(not set)";
        return sendText(env, chatId, `**You're already registered.**\n\nWallet: \`${user.wallet_address}\`\nPay link: ${originFor(env, origin)}/pay/${slug}\n\nTo change your address, send: /wallet <new_address>`, mainKeyboard());
      }
      await setWizard(env, userId, "wallet_addr");
      return sendText(env, chatId, "Send your QIE receive address (0x…).\n\nTIP: If you don't have a QIE Wallet, you can get one here: www.qiewallet.me", cancelKb());
    }
    case "verify": {
      if (cmd.args) return doVerify(env, chatId, user, cmd.args, origin);
      if (user.pass_verified) {
        return sendText(env, chatId, `**You're already verified.**\n\nName: ${user.pass_name || "(unknown)"}\nWallet: \`${user.wallet_address || "(not set)"}\`\n${user.pass_id ? `[View attestation tx](${chainExplorer()}/tx/${user.pass_id})` : ""}\n\nYour identity badge shows on every invoice you create.`, mainKeyboard());
      }
      if (!user.wallet_address) { return sendText(env, chatId, "Set your wallet first: /wallet", mainKeyboard()); }
      await setWizard(env, userId, "verify_name");
      return sendText(env, chatId, "Send the **display name** to attest on-chain.", cancelKb());
    }
    case "invoice": return cmd.args ? doInvoice(env, chatId, user, cmd.args, origin) : (await setWizard(env, userId, "invoice_text"), sendText(env, chatId, "Describe the invoice, e.g. `Brand design for Sarah, $450`.", cancelKb()));
    case "invoices": return doInvoices(env, chatId, user, origin);
    case "stats": return doStats(env, chatId, user);
    case "remitlink": return cmd.args ? doRemit(env, chatId, user, cmd.args, origin) : (await setWizard(env, userId, "remit_slug"), sendText(env, chatId, "Send a short slug (letters/numbers, e.g. `john`).", cancelKb()));
    case "receipt": return doReceipt(env, chatId, user, cmd.args, origin);
    case "cancel-invoice": return doCancelInvoice(env, chatId, user, cmd.args, origin);
    case "status": return doStatus(env, chatId, user, origin);
    case "cancel": await clearWizard(env, userId); return sendText(env, chatId, "Cancelled.");
    default: return sendText(env, chatId, "Unknown command. /help");
  }
}

function cancelKb(): Record<string, unknown> { return { inline_keyboard: [[{ text: "Cancel", callback_data: "act:cancel" }]] }; }

// ---- commands ----
async function onStart(env: Env, chatId: number, user: any, origin: string): Promise<void> {
  const hasWallet = !!user.wallet_address;
  const hasIdentity = !!user.pass_verified;
  const step = hasWallet ? (hasIdentity ? 3 : 2) : 1;

  const check = (done: boolean) => done ? "✅" : "⬜";
  const lines = [
    "**QIE Remit**",
    "",
    "Send invoices and get paid instantly in native QIE on the QIE Blockchain.",
    "",
    "Here's how to get started:",
    "",
    `${check(hasWallet)}  **Set your receive address** — /wallet`,
    `${check(hasIdentity)}  **Verify your identity** — /verify`,
    "⬜  **Create your first invoice** — /invoice",
    "",
    hasWallet && hasIdentity
      ? "You're all set. Create an invoice with /invoice to start receiving payments."
      : hasWallet
        ? "Wallet ready. Next: verify your identity with /verify so clients trust you."
        : "Start by setting your QIE receive address with /wallet.",
  ];
  await sendText(env, chatId, lines.join("\n"), mainKeyboard());
}

async function doWallet(env: Env, chatId: number, user: any, addrInput: string, origin: string): Promise<void> {
  const raw = addrInput.trim();
  if (!isValidAddress(raw)) { await sendText(env, chatId, "That's not a valid EVM address. It must start with `0x` and be 42 chars.", mainKeyboard()); return; }
  const addr = checksumAddress(raw);
  let slug = user.remit_slug;
  if (!slug) { slug = genSlug(user.username || `u${user.tg_user_id}`); }
  await updateUserWallet(env, user.id, addr, slug);
  await sendText(env, chatId, `Wallet set successfully.\n\nWallet: \`${addr}\`\nPay link: ${originFor(env, origin)}/pay/${slug}\n\nNext: /verify your identity.`, mainKeyboard());
}

async function doVerify(env: Env, chatId: number, user: any, name: string, origin: string): Promise<void> {
  if (!user.wallet_address) { await sendText(env, chatId, "Set your wallet first: /wallet", mainKeyboard()); return; }
  const nameTrim = name.trim().slice(0, 60);
  if (!nameTrim) { await sendText(env, chatId, "Please provide a display name.", mainKeyboard()); return; }
  await sendText(env, chatId, "Attesting your identity on-chain…");
  try {
    const c = await getContracts(env);
    if (!c) { await sendText(env, chatId, "Contracts not deployed yet. The operator must deploy them first."); return; }
    const tx = await attestIdentity(env, user.wallet_address, nameTrim);
    await setVerified(env, user.id, nameTrim, tx);
    await sendText(env, chatId,
      `*Identity attested on-chain*\nName: ${nameTrim}\nWallet: \`${user.wallet_address}\`\n[View attestation on explorer](${chainExplorer()}/tx/${tx})\n\nNow create an invoice: /invoice`);
  } catch (e: any) {
    console.error("doVerify attest failed:", e?.message || e, e?.stack);
    await sendText(env, chatId, `Verification failed: ${e.message || e}\n\nIf the operator wallet has no testnet QIE for gas, it must be funded first.`);
  }
}

async function doInvoice(env: Env, chatId: number, user: any, text: string, origin: string): Promise<void> {
  if (!user.wallet_address) { await sendText(env, chatId, "Set your wallet first: /wallet", mainKeyboard()); return; }
  if (!user.pass_verified) { await sendText(env, chatId, "Verify your identity first: /verify (judges & clients trust the badge).", mainKeyboard()); return; }
  await sendText(env, chatId, "Parsing your invoice…");
  let parsed;
  try { parsed = await withTyping(env, chatId, () => parseInvoice(env, text)); }
  catch (e: any) { await sendText(env, chatId, `AI parse failed: ${e.message || e}`); return; }
  if (!parsed.amount || parsed.amount <= 0) { await sendText(env, chatId, "I couldn't find an amount. Try: `/invoice Brand design for Sarah, $450`."); return; }
  const amount = Math.round(parsed.amount * 100) / 100; // human QIE amount (native, 18 dp)
  const desc = parsed.description || text.slice(0, 80);
  const client = parsed.client_name || null;
  try {
    const c = await getContracts(env);
    if (!c) { await sendText(env, chatId, "Contracts not deployed yet. The operator must deploy them first."); return; }
    const onChain = await createInvoiceOnChain(env, user.wallet_address, amount);
    const id = genId("INV");
    const slug = genSlug(id);
    await insertInvoice(env, {
      id, creator_id: user.id, creator_address: user.wallet_address,
      amount, currency: "QIE", description: desc, client_name: client,
      status: "pending", on_chain_id: Number(onChain.invoiceId), create_tx: onChain.txHash, slug,
    });
    const link = `${originFor(env, origin)}/invoice/${slug}`;
    const tip = amount > 2 ? "\n\n_Tip: for smooth testnet demos, use small amounts (≤ 2 QIE) so the built-in faucet can fund payers._" : "";
    const price = await getQiePrice(env);
    const usd = usdEquiv(amount, price);
    await sendText(env, chatId,
      `*Invoice created*\n${id}\nAmount: ${amount} QIE\n${client ? `Billed to: ${client}\n` : ""}Description: ${desc}\nOn-chain #${onChain.invoiceId}\n\n*Payment link:*\n${link}\n\n[View create tx](${chainExplorer()}/tx/${onChain.txHash})\n\nShare the link with your client. I'll notify you when it's paid.${tip}${usd ? `\n\nUSD equiv: ${usd}` : ""}`, mainKeyboard());
  } catch (e: any) {
    await sendText(env, chatId, `Invoice creation failed: ${e.message || e}\n\nIf the operator wallet has no testnet QIE for gas, it must be funded first.`);
  }
}

async function doInvoices(env: Env, chatId: number, user: any, origin: string): Promise<void> {
  const rows = await listInvoicesByCreator(env, user.id, 12);
  if (rows.length === 0) { await sendText(env, chatId, "No invoices yet. Create one with /invoice.", mainKeyboard()); return; }
  const lines = rows.map(r => {
    const badge = r.status === "paid" ? "PAID" : r.status === "expired" ? "EXP" : "PEND";
    return `\`${r.id}\` [${badge}] ${r.amount} QIE — ${originFor(env, origin)}/invoice/${r.slug}`;
  });
  await sendText(env, chatId, "*Your invoices*\n" + lines.join("\n"), mainKeyboard());
}

async function doStats(env: Env, chatId: number, user: any): Promise<void> {
  const earned = await sumPaidThisMonth(env, user.id);
  const unpaid = await unpaidSummary(env, user.id);
  const recent = await recentPaidPayments(env, user.id, 5);
  const price = await getQiePrice(env);
  let summary: string;
  try { summary = await withTyping(env, chatId, () => analytics(env, { earned, unpaid, recent }, price)); }
  catch { summary = fallbackStats(earned, unpaid, recent, price); }
  await sendText(env, chatId, summary, mainKeyboard());
}

function fallbackStats(earned: any, unpaid: any, recent: any[], price?: any): string {
  const usdRate = price && price.usd != null ? price.usd : null;
  const lines = ["*Earnings summary*"];
  lines.push(`Paid this month: ${earned.total} QIE across ${earned.count} invoice(s)${usdRate != null ? ` (≈$${(earned.total * usdRate).toFixed(2)} USD)` : ""}`);
  lines.push(`Unpaid: ${unpaid.count} invoice(s) worth ${unpaid.total} QIE${usdRate != null ? ` (≈$${(unpaid.total * usdRate).toFixed(2)} USD)` : ""}`);
  if (recent.length) lines.push("Recent payments:\n" + recent.map(p => `• ${p.amount} QIE — ${new Date(p.paid_at).toDateString()}`).join("\n"));
  return lines.join("\n");
}

async function doRemit(env: Env, chatId: number, user: any, slugInput: string, origin: string): Promise<void> {
  if (!user.wallet_address) { await sendText(env, chatId, "Set your wallet first: /wallet", mainKeyboard()); return; }
  const slug = slugInput.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (!slug || slug.length < 2) { await sendText(env, chatId, "Slug must be 2+ letters/numbers.", mainKeyboard()); return; }
  const owner = await getUserBySlug(env, slug);
  if (owner && owner !== user.id) { await sendText(env, chatId, "That slug is taken. Choose another.", mainKeyboard()); return; }
  await setRemitSlug(env, user.id, slug);
  await sendText(env, chatId, `Your pay link:\n${originFor(env, origin)}/pay/${slug}`, mainKeyboard());
}

async function doReceipt(env: Env, chatId: number, user: any, idArg: string, origin: string): Promise<void> {
  const id = idArg.trim().toUpperCase();
  if (!id) { await sendText(env, chatId, "Usage: /receipt INV-XXXX"); return; }
  const inv = await getInvoice(env, id);
  if (!inv || inv.creator_id !== user.id) { await sendText(env, chatId, "Invoice not found."); return; }
  if (inv.status !== "paid") { await sendText(env, chatId, "That invoice isn't paid yet."); return; }
  const pdf = await generateReceiptPdf(inv, user);
  await uploadPdfToTelegram(env, chatId, pdf, `${inv.id}.pdf`, `Receipt for ${inv.id}`);
}

async function doCancelInvoice(env: Env, chatId: number, user: any, idArg: string, origin: string): Promise<void> {
  const id = (idArg || "").trim().toUpperCase();
  if (!/^INV-/.test(id)) { await sendText(env, chatId, "Usage: /cancel-invoice INV-XXXX", mainKeyboard()); return; }
  const inv = await getInvoice(env, id);
  if (!inv || inv.creator_id !== user.id) { await sendText(env, chatId, "Invoice not found (or not yours).", mainKeyboard()); return; }
  if (inv.status !== "pending") { await sendText(env, chatId, `Cannot cancel — invoice is *${inv.status}*. Only pending invoices can be cancelled.`, mainKeyboard()); return; }
  await sendText(env, chatId, "Cancelling invoice on-chain…");
  try {
    const c = await getContracts(env);
    if (!c) { await sendText(env, chatId, "Contracts not deployed yet. The operator must deploy them first."); return; }
    const txHash = await cancelInvoiceOnChain(env, inv.on_chain_id);
    await setInvoiceStatus(env, inv.id, "cancelled");
    await sendText(env, chatId,
      `*Invoice cancelled*\n${inv.id}\nOn-chain #${inv.on_chain_id}\n\n[View cancel tx](${chainExplorer()}/tx/${txHash})\n\nThe invoice can no longer be paid. Share a new link if needed: /invoice`, mainKeyboard());
  } catch (e: any) {
    await sendText(env, chatId, `Cancel failed: ${e.message || e}\n\nIf the operator wallet has no testnet QIE for gas, it must be funded first.`);
  }
}

async function doStatus(env: Env, chatId: number, user: any, origin: string): Promise<void> {
  const c = await getContracts(env);
  const lines = [
    "*Your QIE Remit status*",
    `Wallet: ${user.wallet_address ? "`" + user.wallet_address + "`" : "not set — /wallet"}`,
    `Identity: ${user.pass_verified ? "attested (" + user.pass_name + ")" : "not attested — /verify"}`,
    `Pay link: ${user.remit_slug ? originFor(env, origin) + "/pay/" + user.remit_slug : "none — /remitlink"}`,
    "",
    `Contracts: ${c ? "deployed" : "not deployed"}`,
  ];
  if (c) {
    lines.push(`InvoiceRegistry: \`${c.invoiceRegistry}\``);
    lines.push(`IdentityRegistry: \`${c.identityRegistry}\``);
  }
  await sendText(env, chatId, lines.join("\n"), mainKeyboard());
}

function faucetUrl(): string { return "https://www.qie.digital/faucet"; }
function chainExplorer(): string { return "https://testnet.qie.digital"; }

// ---- callback handler (main menu buttons) ----
async function handleCallback(env: Env, cb: TgCallback, origin: string): Promise<void> {
  const data = cb.data || "";
  const chatId = cb.message?.chat.id || 0;
  const userId = `telegram:${cb.from.id}`;
  const user = await getOrCreateUser(env, userId, cb.from.id, cb.from.username || null);
  await answerCallback(env, cb.id);
  if (data === "act:cancel") { await clearWizard(env, userId); await sendText(env, chatId, "Cancelled.", mainKeyboard()); return; }
  if (data === "act:wallet") {
    if (user.wallet_address) {
      const slug = user.remit_slug || "(not set)";
      return sendText(env, chatId, `**You're already registered.**\n\nWallet: \`${user.wallet_address}\`\nPay link: ${originFor(env, origin)}/pay/${slug}\n\nTo change your address, send: /wallet <new_address>`, mainKeyboard());
    }
    await setWizard(env, userId, "wallet_addr");
    return sendText(env, chatId, "Send your QIE receive address (0x…).\n\nTIP: If you don't have a QIE Wallet, you can get one here: www.qiewallet.me", cancelKb());
  }
  if (data === "act:verify") {
    if (user.pass_verified) {
      return sendText(env, chatId, `**You're already verified.**\n\nName: ${user.pass_name || "(unknown)"}\nWallet: \`${user.wallet_address || "(not set)"}\`\n${user.pass_id ? `[View attestation tx](${chainExplorer()}/tx/${user.pass_id})` : ""}\n\nYour identity badge shows on every invoice you create.`, mainKeyboard());
    }
    if (!user.wallet_address) { return sendText(env, chatId, "Set your wallet first: /wallet", mainKeyboard()); }
    await setWizard(env, userId, "verify_name");
    return sendText(env, chatId, "Send the **display name** to attest on-chain.", cancelKb());
  }
  if (data === "act:invoice") { await setWizard(env, userId, "invoice_text"); return sendText(env, chatId, "Describe the invoice, e.g. `Brand design for Sarah, $450`.", cancelKb()); }
  if (data === "act:invoices") return doInvoices(env, chatId, user, origin);
  if (data === "act:stats") return doStats(env, chatId, user);
  if (data === "act:remit") return sendText(env, chatId, user.remit_slug ? `Your pay link: ${originFor(env, origin)}/pay/${user.remit_slug}\nChange it: /remitlink <slug>` : "Set a slug: /remitlink <slug>", mainKeyboard());
}

// ---- paid notification (called by the confirm webhook in index.ts) ----
export async function notifyCreatorPaid(env: Env, invId: string): Promise<void> {
  const inv = await getInvoice(env, invId);
  if (!inv || inv.status !== "paid") return;
  const creator = await getUser(env, inv.creator_id);
  if (!creator) return;
  const chatId = creator.tg_user_id; // DM chat id == user id
  await sendText(env, chatId,
    `*Payment received*\nInvoice ${inv.id}\n${inv.amount} QIE from \`${inv.payer_address}\`\n[View tx](${chainExplorer()}/tx/${inv.pay_tx})\nGenerating receipt…`, mainKeyboard());
  try {
    const pdf = await generateReceiptPdf(inv, creator);
    await uploadPdfToTelegram(env, chatId, pdf, `${inv.id}.pdf`, `Receipt for ${inv.id} — paid`);
  } catch (e: any) {
    await sendText(env, chatId, `(Receipt PDF skipped: ${e.message || e})\nView online: ${originFor(env)}/receipt/${inv.id}`);
  }
}

// ---- webhook entry ----
export async function handleTelegramWebhook(request: Request, env: Env, ctx: ExecutionContext, origin: string): Promise<Response> {
  if (env.TELEGRAM_WEBHOOK_SECRET) {
    const tok = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (tok !== env.TELEGRAM_WEBHOOK_SECRET) return new Response("Unauthorized", { status: 401 });
  }
  const update: TgUpdate = await request.json();
  if (update.callback_query) { ctx.waitUntil(handleCallback(env, update.callback_query, origin)); return new Response("OK"); }
  if (update.message) {
    const id = update.message.from?.id;
    if (!id) return new Response("Missing user", { status: 400 });
    ctx.waitUntil(handleMessage(env, update.message, origin));
    return new Response("OK");
  }
  return new Response("OK");
}

export async function setTelegramWebhook(env: Env, origin: string): Promise<string> {
  const body: Record<string, unknown> = { url: `${origin}/telegram`, allowed_updates: ["message", "callback_query"] };
  if (env.TELEGRAM_WEBHOOK_SECRET) body.secret_token = env.TELEGRAM_WEBHOOK_SECRET;
  return JSON.stringify(await tgApi(env, "setWebhook", body));
}
export async function registerTelegramCommands(env: Env): Promise<string> {
  return JSON.stringify(await tgApi(env, "setMyCommands", { commands: BOT_COMMANDS }));
}
