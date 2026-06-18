export interface Env {
  // KV namespaces
  SESSIONS: KVNamespace;
  CONFIG: KVNamespace;

  // D1
  DB: D1Database;

  // Telegram
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET?: string;

  // Authorization
  ALLOWED_USERS?: string; // comma-separated Telegram user IDs
  ADMIN_TG_ID?: string; // telegram user id allowed to run /deploy
  API_KEY?: string; // admin bearer token

  // Operator wallet (encrypts the on-chain operator key stored in CONFIG KV)
  WALLET_ENCRYPTION_KEY: string;

  // QIE chain config
  QIE_RPC?: string; // default https://rpc1testnet.qie.digital/
  QIE_CHAIN_ID?: string; // default 1983
  QIE_EXPLORER?: string; // default https://testnet.qie.digital/

  // AI (OpenRouter preferred; OpenAI-compatible). Optional.
  AI_API_KEY?: string;
  AI_BASE_URL?: string; // default https://openrouter.ai/api/v1
  AI_MODEL?: string; // default openrouter auto, or e.g. "openai/gpt-4o-mini"

  // Public base URL for invoice/remit/receipt pages (set to your workers.dev or custom domain)
  PUBLIC_BASE_URL?: string;
}

// ---- On-chain / contract state ----

export interface ContractsConfig {
  qusdc: `0x${string}`;
  identity: `0x${string}`;
  invoice: `0x${string}`;
  chainId: number;
  rpc: string;
  deployer: string;
  deployedAt: number;
}

export interface OnChainInvoice {
  creator: string;
  token: string;
  amount: bigint;
  paid: boolean;
  paidAt: bigint;
  payer: string;
  exists: boolean;
}

// ---- DB row shapes ----

export interface UserRow {
  id: string;
  tg_id: number;
  username: string | null;
  wallet_address: string | null;
  display_name: string | null;
  verified: number; // 0/1
  pass_id: string | null;
  remit_slug: string | null;
  created_at: number;
}

export interface InvoiceRow {
  id: string;
  public_id: string;
  creator_tg: string;
  creator_address: string;
  amount: number; // human units
  currency: string;
  description: string | null;
  client_name: string | null;
  chain_invoice_id: number | null;
  status: string; // pending | paid | cancelled
  tx_hash: string | null;
  payer_address: string | null;
  paid_at: number | null;
  created_at: number;
}

// ---- Telegram ----

export interface TgUser {
  id: number;
  first_name: string;
  username?: string;
}

export interface TgMessage {
  message_id: number;
  from: TgUser;
  chat: { id: number; type: string };
  text?: string;
  caption?: string;
}

export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

// ---- Wizard states (stored in CONFIG KV with TTL) ----

export type WizardState =
  | { step: "awaiting_wallet"; started_at: number }
  | { step: "awaiting_name"; started_at: number }
  | { step: "awaiting_invoice_amount"; draft: InvoiceDraft; started_at: number }
  | { step: "awaiting_invoice_desc"; draft: InvoiceDraft; started_at: number }
  | { step: "awaiting_invoice_client"; draft: InvoiceDraft; started_at: number }
  | { step: "awaiting_invoice_confirm"; draft: InvoiceDraft; started_at: number }
  | { step: "awaiting_remit_slug"; started_at: number }
  | { step: "awaiting_pay_amount"; payer_tg: number; invoice_ids: number[]; started_at: number };

export interface InvoiceDraft {
  amount?: number;
  currency: string;
  description?: string;
  client_name?: string;
}

export interface AiInvoiceParse {
  amount?: number;
  currency?: string;
  description?: string;
  client_name?: string;
  error?: string;
}
