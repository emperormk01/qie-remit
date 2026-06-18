import type { Env } from "./types";
import type { QiePrice } from "./price";

export interface ParsedInvoice {
  amount: number | null;
  currency: string; // always QIE (native) for v1
  description: string | null;
  client_name: string | null;
}

const SYSTEM = `You are QIE Remit's invoice parser. Convert a freelancer's natural-language request into a structured invoice. Output STRICT JSON only, no prose.
Schema: {"amount": number|null, "currency":"QIE", "description": string|null, "client_name": string|null}
Rules:
- amount is a positive number denominated in QIE (the native token). Treat a stated dollar figure (e.g. "$500") as that many test QIE units for the demo. null if not stated.
- currency is always "QIE".
- description is a short invoice line (<=80 chars). null if none.
- client_name is the payer/recipient name if mentioned, else null.
- If the request is not an invoice intent, return {"amount":null,"currency":"QIE","description":null,"client_name":null}`;

interface RecentPay {
  id: string;
  amount: number;
  status: string;
  client_name: string | null;
  description: string | null;
  paid_at: number | null;
}

/** Build the OpenAI-compatible chat completions endpoint from a base URL.
 *  Accepts AI_BASE_URL either as a true base (e.g. https://host/v1) or already
 *  including /chat/completions, and normalizes to the full path. */
function chatCompletionsUrl(rawBase: string): string {
  const base = rawBase.replace(/\/+$/, "");
  if (base.endsWith("/chat/completions")) return base;
  if (base.endsWith("/v1")) return `${base}/chat/completions`;
  // bare host or unknown — append the standard OpenAI path
  return `${base}/v1/chat/completions`;
}

/** Fetch an OpenAI-compatible chat completion; returns null on any failure so callers fall back. */
async function chat(env: Env, system: string, user: string, temperature: number, jsonMode = false): Promise<string | null> {
  const key = env.AI_API_KEY;
  if (!key) return null;
  const base = chatCompletionsUrl(env.AI_BASE_URL || "https://openrouter.ai/api/v1/chat/completions");
  try {
    const resp = await fetch(base, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        ...(base.includes("openrouter.ai") ? { "HTTP-Referer": "https://qieremit.app", "X-Title": "QIE Remit" } : {}),
      },
      body: JSON.stringify({
        model: env.AI_MODEL || "openai/gpt-4o-mini",
        temperature,
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!resp.ok) return null;
    const data: any = await resp.json();
    return data?.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

/**
 * Parse a free-text invoice request into structured fields.
 * Uses the configured AI provider if AI_API_KEY is set, else a local regex fallback.
 */
export async function parseInvoice(env: Env, text: string): Promise<ParsedInvoice> {
  const content = await chat(env, SYSTEM, text, 0, true);
  if (!content) return fallbackParse(text);
  try {
    const parsed = JSON.parse(content);
    return {
      amount: typeof parsed.amount === "number" && parsed.amount > 0 ? parsed.amount : null,
      currency: "QIE",
      description: typeof parsed.description === "string" ? parsed.description.slice(0, 80) : null,
      client_name: typeof parsed.client_name === "string" ? parsed.client_name.slice(0, 60) : null,
    };
  } catch {
    return fallbackParse(text);
  }
}

function fallbackParse(text: string): ParsedInvoice {
  const amountMatch =
    text.match(/(?:\$|usd|qusdc|\bamount\s*:?)\s*([0-9]+(?:\.[0-9]{1,2})?)/i) ||
    text.match(/\b([0-9]+(?:\.[0-9]{1,2})?)\s*(?:usd|qusdc|\$)\b/i) ||
    text.match(/\b([0-9]+(?:\.[0-9]{1,2})?)\b/);
  const amount = amountMatch ? parseFloat(amountMatch[1]) : null;
  const clientMatch = text.match(/(?:for|to|from|client[:\s]+)\s*([A-Z][a-zA-Z]{1,30})/);
  return {
    amount: amount && amount > 0 ? amount : null,
    currency: "QIE",
    description: text.slice(0, 80),
    client_name: clientMatch ? clientMatch[1] : null,
  };
}

/** Templated earnings summary used when AI is unavailable. */
function earningsTemplate(ctx: {
  earned: { total: number; count: number };
  unpaid: { count: number; total: number };
  recent: RecentPay[];
}, price?: QiePrice): string {
  const recent = ctx.recent
    .slice(0, 5)
    .map((i) => `- ${i.id} | ${i.amount} QIE | ${(i.client_name || i.description || "").slice(0, 30)}`)
    .join("\n");
  const usdRate = price && price.usd != null ? price.usd : null;
  const usdLines = usdRate != null
    ? `  This month: ≈$${(ctx.earned.total * usdRate).toFixed(2)} USD\n` +
      `  Outstanding: ≈$${(ctx.unpaid.total * usdRate).toFixed(2)} USD\n`
    : "";
  return (
    `*Earnings Summary*\n\n` +
    `This month: *${ctx.earned.total} QIE* across ${ctx.earned.count} payment(s).\n` +
    `Outstanding: *${ctx.unpaid.total} QIE* across ${ctx.unpaid.count} invoice(s).\n` +
    (usdRate != null ? `\n*USD equivalent* (QIE @ $${usdRate.toFixed(4)})\n${usdLines}` : "") +
    `\nRecent payments:\n${recent || "—"}`
  );
}

/**
 * AI-generated analytics summary for a freelancer. Falls back to a templated
 * summary computed from stats if no AI key is configured.
 */
export async function analytics(
  env: Env,
  ctx: {
    earned: { total: number; count: number };
    unpaid: { count: number; total: number };
    recent: RecentPay[];
  },
  price?: QiePrice
): Promise<string> {
  const template = earningsTemplate(ctx, price);
  const content = await chat(
    env,
    "You are QIE Remit's payments analyst. Given invoice stats, write a 4-6 line Telegram-friendly summary with one actionable insight. Use plain markdown (*bold*). No headers. Be concise.",
    JSON.stringify({ ...ctx, price }),
    0.4
  );
  if (!content) return template;
  return content.slice(0, 1500);
}
