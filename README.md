# QIE Remit

**Get paid in crypto with a Telegram bot.**

You send invoices. People pay you in native QIE on QIE Blockchain. Identity is attested on-chain. Everything is recorded on-chain.

---

## Why QIE Remit?

I want you to imagine you’re a freelance designer in let's say Africa or Asia. You’ve just finished a logo for a client in London. They love it. Now comes the part everyone hates: getting paid.

If you use PayPal, you’re looking at a 5% fee, a terrible exchange rate, and the constant fear that your account might be arbitrarily locked for "suspicious activity." If you use a bank wire, you’re waiting three to five business days, losing $30 on intermediary fees, and dealing with a mountain of paperwork just to prove the money is yours.

Now, imagine the London client says, "Do you take crypto?"

You want to say yes because you know it settles in seconds for pennies. But then you think about the friction: you have to send them a raw, intimidating 42-character wallet address. They have to copy-paste it, triple-check every digit, open a wallet, manually enter the amount, and send it. If they make one typo, your hard work vanishes into the void. It feels sketchy, unprofessional, and stressful for both parties.

**That is why we built QIE Remit.** It is PayPal.me for the QIE blockchain.

As a freelancer, you don't build a website or download a complex app. You just chat with our Telegram bot. You type: `/invoice Brand design for Sarah, $450`.

Our lightweight AI parses the request, mints an on-chain invoice, and hands you back a shareable payment link.

Your client opens that link on their phone, copies your address, and sends the exact amount directly to your wallet on the QIE network. Once they paste the transaction hash to confirm, our on-chain verification engine decodes the state, instantly marks the invoice as paid, generates a PDF receipt, and pings you on Telegram.

The payment is settled directly to your wallet in under 2 seconds, for a gas fee of roughly $0.0001, backed by a real identity attested on-chain.

No UI to build and no repetitive KYC. Just one conversation, one invoice, and instant global settlement.

---

## How It Works (Simple)

```markdown
You (freelancer)          Telegram Bot           Client (payer)
     │                         │                       │
     │  "/invoice $500"        │                       │
     ├────────────────────────▶│                       │
     │                         │ Creates invoice       │
     │  ← payment link         │ on QIE blockchain     │
     │◄────────────────────────┤                       │
     │                         │                       │
     │  Share the link ───────────────────────────────▶│
     │                         │                       │
     │                         │   Client opens link   │
     │                         │   Connects wallet     │
     │                         │   Pays in QIE         │
     │                         │◄──────────────────────┤
     │                         │                       │
     │  "You got paid!"        │                       │
     │◄────────────────────────┤                       │
```

1. **You** send a message to the bot: `/invoice $500 for website design`
2. The bot creates an invoice on the QIE blockchain
3. You get a **payment link** like `https://qie-remit.../invoice/abc123`
4. You send that link to your client
5. Your client opens it, connects their wallet, and pays in QIE
6. The money goes **straight to your wallet** — no middleman
7. The bot tells you when you're paid

That's it. That's the whole thing.

**(NOTE: QIE REMIT IS CURRENTLY BUILT ON QIE TESTNET).**

---

## Getting Started (3 Steps)

### Step 1: Talk to the bot

Open Telegram and message [QIE Remit](https://t.me/QieRemit_bot) (@QieRemit_bot). Send `/start`.

### Step 2: Set your wallet

Tell the bot where to receive money.

Send:

```markdown
/wallet
```

Then paste your QIE wallet address (starts with `0x`).

**TIP:** If you don't have a QIE wallet, you can easily set it up here: [www.qiewallet.me](https://www.qiewallet.me/)

### Step 3: Verify your identity

This proves you're really you. Send:

```markdown
/verify
```

Then type your name. The bot attests your identity **on-chain** (a trusted
verifier signs that your wallet belongs to a named, real person). Now your
invoices show an "Identity attested on-chain" badge — so clients trust you.

> NOTE: This is not the official QIE Pass, QIE Remit ships a stand-in `IdentityRegistry` contract
> with the read ABI (`isVerified` / `getIdentity`).

---

## Creating Your First Invoice

Just talk normally. The bot understands.

```markdown
/invoice $500 for website design for Sarah
```

Or:

```markdown
/invoice Brand logo design, 250 qie
```

The bot figures out the amount and description. Then it gives you a link like this:

```markdown
https://qie-remit.georgeo-qie.workers.dev/invoice/abc123
```

**Send that link to your client.** That's all you do.

---

## What Your Client Sees

When your client opens the link, they see:

- Your name
- The amount (e.g. "500 QIE")
- An "Identity attested on-chain" badge (if you verified)
- A **"Copy"** button

They click it, send the QIE, and it lands in your wallet. The page shows "PAID"
and they can view a receipt.

---

## All the Commands

| Command | What it does |
| --- | --- |
| `/start` | Get started, see your progress |
| `/wallet` | Set your QIE wallet address |
| `/verify` | Attest your identity on-chain |
| `/invoice` | Create an invoice (just describe it) |
| `/invoices` | See all your invoices |
| `/stats` | See how much you've earned |
| `/remitlink` | Make your own PayPal.me-style link |
| `/receipt` | Download a PDF receipt for a paid invoice |
| `/status` | Check your setup |
| `/help` | See all commands |
| `/cancel` | Cancel something you started |

---

## Your Payment Link (`/remitlink`)

Want your own link like `qieremit.app/pay/john`? Run:

```markdown
/remitlink john
```

Now anyone can go to your link to see who you are and that you're verified. Share it in your bio, email signature, anywhere.

---

## Getting Test Money (QIE)

This runs on **QIE Testnet** (fake money for testing). If your client needs
test QIE to pay you, the invoice page has a **"Get test QIE"** button — it
forwards up to 2 test QIE from the operator's faucet (once per wallet per 24h,
reserving enough QIE for the operator's own gas).

For more test QIE, use the official QIE faucet:

- https://www.qie.digital/faucet
- Paste your wallet address
- Get 2 free QIE per day

---

## Receipts

When an invoice is paid, you can get a PDF receipt:

```markdown
/receipt INV-AB12
```

The receipt shows the amount, who paid, when, and the transaction on the blockchain. You can print it or save it as PDF.

---

## Is This Safe?

- **Your money goes directly to your wallet.** The bot never holds it.
- **Identity is attested on-chain.** No one can fake being you.
- **Every payment is recorded on QIE Blockchain.** You can prove you got paid.
- **Near-zero fees.** QIE charges \~$0.0001 per transaction.

---

## Technical Details (for developers)

### Tech Stack

| Layer | Tech |
| --- | --- |
| Runtime | Cloudflare Workers (edge, Bun) |
| Storage | Cloudflare D1 (SQLite) + KV (SESSIONS, CONFIG) |
| Chain lib | viem 2.x (wallet clients, contract reads/writes) |
| Contracts | Solidity 0.8.x, compiled with `solc` npm (no Foundry) |
| AI | OpenAI-compatible (OpenRouter preferred); optional, regex fallback |
| Bot | Telegram Bot API (webhook mode, secret-token auth) |
| PDF | pdf-lib  |
| Frontend | Server-rendered HTML + ethers v6 via esm.sh |

### Architecture

```markdown
            Telegram (user DM)
                  │  POST /telegram (X-Telegram-Bot-Api-Secret-Token)
                  ▼
        ┌─────────────────────┐
        │  Cloudflare Worker  │  src/index.ts (router)
        │  qie-remit          │
        └──┬───┬───┬───┬──────┘
           │   │   │   │
   /telegram   │   │   └─ /admin/*  (bearer API_KEY)
   bot flow    │   │
        ┌──────┘   └──────┐
        ▼                 ▼
   src/telegram.ts   src/pages.ts        ← /invoice/:slug, /pay/:slug, /receipt/:id
   (commands,         (server HTML +
    wizards,           ethers client-side
    inline kb)         wallet connect)
        │
        ├─ src/ai.ts        ← invoice parsing + analytics
        ├─ src/chain.ts     ← viem clients, deploy, createInvoice, payInvoice, attest
        ├─ src/wallet.ts    ← AES-GCM operator key encrypt/decrypt in CONFIG KV
        ├─ src/db.ts        ← D1 users/invoices/payments CRUD
        ├─ src/receipt.ts   ← pdf-lib receipt generation
        └─ src/markdown.ts  ← Telegram MarkdownV2 escaper

   State:
   ├── D1 (DB binding)    → users, invoices, payments, usage_log
   ├── KV CONFIG          → operator_wallet, contracts config, faucet rate-limit keys
   └── KV SESSIONS        → (reserved for conversation state)
```

### Deployed Contracts (QIE Testnet, chain ID 1983)

These are the **live** addresses on QIE Testnet (paris-compiled, native-QIE):

| Contract | Address |
| --- | --- |
| IdentityRegistry | `0x738118ec294b3497d7ab8bf9a6187248d9194cf6` |
| InvoiceRegistry | `0x0e9c52315112f1f07088ec63146d915c57428d47` |
| Operator wallet | `0x70C609b257180D7Da357f5182821E9B02c5eb00E` |

- **Payment currency**: native QIE (18 decimals), NOT a stablecoin. The QIE
  testnet has no official testnet stablecoin, so invoices settle in native QIE
  directly. 
- **Chain config**: RPC `https://rpc1testnet.qie.digital/`, explorer `https://testnet.qie.digital/`
- Both contracts have **parameterless constructors**. Owner/verifier is set to
  `msg.sender` (the operator) at deploy.
- **Operator wallet**: auto-generated EOA, private key AES-GCM encrypted in KV
  `CONFIG`. 

### IdentityRegistry (`contracts/IdentityRegistry.sol`)

On-chain identity attestation store (not the official QIE Pass). Operator is the sole verifier at deploy.

- `attest(address user, string name)` — verifier only. Emits `Attested(user, name, verifiedAt)`. This is the "identity verification" — operator attests
  on the freelancer's behalf.
- `revoke(address user)` — verifier only.
- `isVerified(address) → bool`, `getIdentity(address) → (name, verified, verifiedAt)`.
- `setVerifier(address, bool)` — owner only.
- Events: `Attested(user, name, verifiedAt)`, `Revoked(user)`, `VerifierSet`.

### InvoiceRegistry (`contracts/InvoiceRegistry.sol`)

The core payment primitive. **Native-QIE pull-payment model**: payer calls
`payInvoice(id)` sending `msg.value == amount`; the registry forwards the
native QIE to the invoice's creator.

- `createInvoice(address creator, uint256 amount) → uint256 id` — issuer only
  (operator). Emits `InvoiceCreated(id, creator, amount)`. Amount is in wei
  (18 dp).
- `payInvoice(uint256 id) payable` — anyone. Requires `msg.value == invoice.amount`. Forwards the native QIE to the creator. Emits `Paid(id, payer, creator, amount, paidAt)`. Reverts `AlreadyPaid` / `NotPayable`
  (cancelled) / `WrongAmount` / `TransferFailed`.
- `getInvoice(id) → (creator, amount, paid, paidAt, payer)` (no `token` field
  — native only), `isPaid(id) → bool`.
- `setIssuer(address, bool)` — owner only.
- Errors: `NotIssuer`, `NotOwner`, `ZeroAddress`, `InvalidAmount`, `AlreadyPaid`,
  `NotPayable`, `WrongAmount`, `TransferFailed`.

### Request Flow — Invoice Creation

1. User DMs bot: `/invoice Brand design for Sarah, $450`
2. `file telegram.ts` → `ai.parseInvoice()` extracts `{amount, currency, description, client_name}`
3. `chain.createInvoiceOnChain()` — operator wallet signs `InvoiceRegistry.createInvoice(creator, amount)` in wei (operator pays gas)
4. `db.createInvoiceRow()` stores the row with the on-chain id + slug
5. Bot replies with `https://<worker>/invoice/<slug>`

### Request Flow — Payment

1. Client opens `/invoice/<slug>` → `pages.invoicePage()` renders HTML + ethers
2. Client connects wallet → `ethers.BrowserProvider` → switch to QIE chain (1983)
3. If low balance, POST `/api/faucet` with `{address, amount}` (operator forwards test QIE)
4. `registry.payInvoice(id, { value: amount })` — single native-QIE transaction, no approve step
5. `InvoiceRegistry.payInvoice` forwards the QIE to the creator
6. Client POSTs tx hash to `/api/invoice/<slug>/confirm` → `chain.verifyPaymentTx()` verifies receipt → `db.markInvoicePaid()` → bot notifies freelancer

### Directory Structure

```markdown
qie-remit/
├── contracts/
│   ├── IdentityRegistry.sol       # On-chain identity attestation store
│   └── InvoiceRegistry.sol        # Native-QIE pull-payment invoice primitive
├── scripts/
│   ├── compile.ts                 # solc npm (evmVersion: paris) → src/artifacts/*.json
│   └── deploy.ts                  # Standalone deploy (optional, admin endpoint preferred)
├── src/
│   ├── artifacts/                 # Compiled ABIs + bytecode (build output)
│   ├── types.ts                   # Env interface, row types, constants
│   ├── index.ts                   # Worker router (telegram, pages, admin, health)
│   ├── telegram.ts                # Bot commands, wizards, inline keyboards
│   ├── chain.ts                   # viem clients, deploy, on-chain reads/writes
│   ├── wallet.ts                  # Operator key gen + AES-GCM encrypt/decrypt
│   ├── db.ts                      # D1 CRUD + earnings stats
│   ├── ai.ts                      # Invoice parsing + analytics (fallback safe)
│   ├── pages.ts                   # /invoice, /pay, /receipt HTML
│   ├── receipt.ts                 # pdf-lib receipt generator
│   ├── markdown.ts                # Telegram MarkdownV2 escaper
│   └── utils.ts                   # genId, genSlug, isValidAddress, userId
├── schema.sql                     # D1 schema
├── wrangler.toml                  # Bindings + vars (no secrets)
├── package.json
├── tsconfig.json
└── .dev.vars.example              # Local dev secrets template
```

### D1 Schema (`file schema.sql`)

4 tables:

- **users** — `id` (telegram:), `tg_user_id`, `username`, `wallet_address`, `pass_name`, `pass_verified` (0/1), `pass_id`, `remit_slug`, `created_at`, `updated_at`.
- **invoices** — `id` (INV-XXXX), `on_chain_id`, `creator_id`, `creator_address`, `amount` (QIE units, 18 dp), `currency` (`QIE`), `description`, `client_name`, `slug`, `status` (pending|paid|cancelled), `create_tx`, `pay_tx`, `payer_address`, `paid_at`, `created_at`.
- **payments** — `invoice_id`, `on_chain_id`, `tx_hash` (unique), `payer`, `amount`, `paid_at`.
- **usage_log** — `user_id`, `action`, `detail`, `tokens`, `created_at`.

### Local Development

```bash
cd qie-remit
bun install
bun run compile      # compile contracts → src/artifacts/  (evmVersion: paris)
bun run typecheck    # tsc --noEmit
cp .dev.vars.example .dev.vars   # fill local secrets
bunx wrangler dev    # local worker on http://localhost:8787
```

### Deployment

```bash
cd qie-remit
export CLOUDFLARE_API_TOKEN="<your-token>"

# 1. Compile contracts if changed (ALWAYS use evmVersion: paris)
bun run compile

# 2. Typecheck (must pass)
bun run typecheck

# 3. Deploy worker
bunx wrangler deploy

# 4. (first time) create resources
bunx wrangler kv namespace create SESSIONS
bunx wrangler kv namespace create CONFIG
bunx wrangler d1 create qie-remit
bunx wrangler d1 execute qie-remit --file=./schema.sql --remote

# 5. (first time) set secrets + webhook
bunx wrangler secret put TELEGRAM_BOT_TOKEN
# ...set other secrets...
curl -s "https://api.telegram.org/bot<TOKEN>/setWebhook" 
  -d "url=https://<worker-url>/telegram" -d "secret_token=<SECRET>"

# 6. (first time) deploy contracts
curl -X POST "https://<worker-url>/admin/deploy" 
  -H "Authorization: Bearer <API_KEY>"
```

### QIE Blockchain Facts

- **Testnet chain ID**: 1983 (NOT 5656 — that was old V2)
- **Testnet RPC**: `https://rpc1testnet.qie.digital/`
- **Explorer**: `https://testnet.qie.digital/`
- **Faucet**: `https://www.qie.digital/faucet` (2 QIE / 24h, has Cloudflare challenge — claim manually)
- **Mainnet chain ID**: 5656 (not used by QIE Remit yet)
- **Gas**: \~$0.0001/tx, 2s finality, EVM-compatible
- **Native token**: QIE (18 decimals) — used directly for invoice settlement

### Build Guardrails

- **Always** `bun run typecheck` before `wrangler deploy`.
- **Always** `bun run compile` after touching any `.sol` file.
- **CRITICAL — EVM version**: keep `evmVersion: "paris"` in
  `file scripts/compile.ts`. The QIE testnet EVM is pre-Shanghai and does NOT
  implement opcode `0x5e` (MCOPY). Compiling with the default
  `shanghai`/`cancun` target produces bytecode that reverts with `invalid opcode: opcode 0x5e not defined` on every call (including reads).
- **CRITICAL — gas floors**: the QIE node returns unreliable
  `eth_estimateGas` values (often exactly equal to the gas limit, causing
  out-of-gas reverts). All `writeContract`/`sendTransaction` calls in
  `file src/chain.ts` set an explicit `gas: 300000n` floor. Only gas actually used
  is charged, so this is safe. Do not remove the gas floors.
- Contracts compile with `solc` npm (no Foundry/Hardhat) — keep imports
  dependency-free.
- `src/artifacts/` is build output — regenerate, don't hand-edit.
- Frontend uses ethers v6 via `file esm.sh` URL import in `file pages.ts` — do not add it
  to `file package.json` (it's browser-only, not a worker dep).

---

## FAQ

**Q: Do I need to build a website?**
No. The Telegram bot is the whole interface.

**Q: Does the bot hold my money?**
No. Payments go directly from the client's wallet to your wallet on the blockchain.

**Q: What currency am I paid in?**
Native QIE (18 decimals), the chain's own token. No stablecoin is wired in yet
because QIE testnet doesn't have an official testnet stablecoin. When one
ships, the InvoiceRegistry's payment primitive can be swapped to it.

**Q: What is "identity attested on-chain"?**
A trusted verifier (the operator, for the demo) signs a record on the
`IdentityRegistry` contract that says "this wallet belongs to this named
person." Every invoice then shows the badge, so clients know you're real. This
is a stand-in for the official QIE Pass; when QIE publishes its real Pass
contract, the reads point there instead.

**Q: How much does it cost?**
Almost nothing. QIE gas fees are \~$0.0001 per transaction.

**Q: Can I use this for real money?**
Right now it's on testnet (fake money). The same code works on mainnet with
real QIE — switch `QIE_RPC` / `QIE_CHAIN_ID` and redeploy.

---

## Links

- QIE Blockchain: https://www.qie.digital
- QIE Pass: https://qiepass.qie.digital
- QIE Faucet: https://www.qie.digital/faucet
- Explorer: https://testnet.qie.digital
- Docs: https://docs.qie.digital

---

**QIE Remit**: Send invoices. Get paid in crypto. That simple.