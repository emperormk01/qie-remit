import type { Env } from "./types";
import { ensureOperator, getOperatorKey } from "./wallet";
import InvoiceRegistry from "./artifacts/InvoiceRegistry.json";
import IdentityRegistry from "./artifacts/IdentityRegistry.json";

type Abi = typeof InvoiceRegistry.abi;

export interface Contracts {
  invoiceRegistry: `0x${string}`;
  identityRegistry: `0x${string}`;
}

// QIE Testnet (chain 1983). Custom chain since viem has no built-in QIE entry.
export const QIE_TESTNET = {
  id: 1983,
  name: "QIE Testnet",
  nativeCurrency: { name: "QIE", symbol: "QIE", decimals: 18 },
  rpcUrls: {
    default: {
      http: ["https://rpc1testnet.qie.digital/"],
    },
  },
  blockExplorers: {
    default: { name: "QIE Testnet Explorer", url: "https://testnet.qie.digital" },
  },
  testnet: true,
} as const;

// Native QIE has 18 decimals (standard EVM gas token). Amounts stored human and
// converted with parseEther at the chain boundary.
export const QIE_DECIMALS = 18;
const EXPLORER = "https://testnet.qie.digital";

export function explorerTx(hash: string): string {
  return `${EXPLORER}/tx/${hash}`;
}
export function explorerAddr(addr: string): string {
  return `${EXPLORER}/address/${addr}`;
}

/** Base explorer URL (used by the router for faucet confirmations and links). */
export function chainExplorer(): string {
  return EXPLORER;
}

async function rpcUrl(env: Env): Promise<string> {
  return (env.QIE_RPC || QIE_TESTNET.rpcUrls.default.http[0]) as string;
}

async function publicClient(env: Env) {
  const { createPublicClient, http } = await import("viem");
  return createPublicClient({
    chain: { ...QIE_TESTNET, rpcUrls: { default: { http: [await rpcUrl(env)] } } } as any,
    transport: http(),
  });
}

async function walletClient(env: Env, privateKey: `0x${string}`) {
  const { createWalletClient, http } = await import("viem");
  const { privateKeyToAccount } = await import("viem/accounts");
  const account = privateKeyToAccount(privateKey);
  return createWalletClient({
    account,
    chain: { ...QIE_TESTNET, rpcUrls: { default: { http: [await rpcUrl(env)] } } } as any,
    transport: http(),
  });
}

// ---- Contract address management ----

export async function getContracts(env: Env): Promise<Contracts | null> {
  return (await env.CONFIG.get("contracts", "json")) as Contracts | null;
}

export async function setContracts(env: Env, c: Contracts): Promise<void> {
  await env.CONFIG.put("contracts", JSON.stringify(c));
}

export function artifactBytecode(hex: string): `0x${string}` {
  return (hex.startsWith("0x") ? hex : "0x" + hex) as `0x${string}`;
}

// ---- Deployment ----

export async function deployContracts(env: Env): Promise<Contracts> {
  const existing = await getContracts(env);
  if (existing) return existing;

  const key = await getOperatorKey(env);
  if (!key) {
    // Ensure an operator wallet exists; deployment uses the operator as deployer.
    await ensureOperator(env);
    const k = await getOperatorKey(env);
    if (!k) throw new Error("Operator key unavailable");
    return deployWith(env, k);
  }
  return deployWith(env, key);
}

async function deployWith(env: Env, key: `0x${string}`): Promise<Contracts> {
  const wc = await walletClient(env, key);
  const pc = await publicClient(env);

  const deploy = async (artifact: { abi: Abi; bytecode: string }, args: unknown[] = []) => {
    const hash = await wc.deployContract({
      abi: artifact.abi as any,
      bytecode: artifactBytecode(artifact.bytecode),
      args,
      chain: null as any,
    });
    const receipt = await pc.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("Deploy failed: " + hash);
    return receipt.contractAddress as `0x${string}`;
  };

  const operator = (await ensureOperator(env)).address as `0x${string}`;
  const identityRegistry = await deploy(IdentityRegistry);
  const invoiceRegistry = await deploy(InvoiceRegistry);

  const contracts: Contracts = { identityRegistry, invoiceRegistry };
  await setContracts(env, contracts);
  return contracts;
}

// ---- Operator actions ----

export async function createInvoiceOnChain(
  env: Env,
  creator: `0x${string}`,
  amountHuman: number
): Promise<{ invoiceId: bigint; txHash: `0x${string}` }> {
  const c = await getContracts(env);
  if (!c) throw new Error("Contracts not deployed. Call /admin/deploy first.");
  const key = await getOperatorKey(env);
  if (!key) throw new Error("Operator key unavailable");
  const wc = await walletClient(env, key);
  const { parseEther } = await import("viem");
  const amount = parseEther(String(amountHuman));
  const hash = await wc.writeContract({
    address: c.invoiceRegistry,
    abi: InvoiceRegistry.abi as any,
    functionName: "createInvoice",
    args: [creator, amount],
    gas: 300000n, // QIE node gas estimates are unreliable; set a safe floor (only gas used is charged)
    chain: null as any,
  });
  const pc = await publicClient(env);
  const receipt = await pc.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("createInvoice tx failed: " + hash);
  const id = await extractInvoiceId(receipt.logs, c.invoiceRegistry);
  if (id === null) throw new Error("InvoiceCreated event not found in receipt");
  return { invoiceId: id, txHash: hash };
}

export async function cancelInvoiceOnChain(
  env: Env,
  onChainId: number
): Promise<{ txHash: `0x${string}` }> {
  const c = await getContracts(env);
  if (!c) throw new Error("Contracts not deployed. Call /admin/deploy first.");
  const key = await getOperatorKey(env);
  if (!key) throw new Error("Operator key unavailable");
  const wc = await walletClient(env, key);
  const hash = await wc.writeContract({
    address: c.invoiceRegistry,
    abi: InvoiceRegistry.abi as any,
    functionName: "cancelInvoice",
    args: [BigInt(onChainId)],
    gas: 300000n, // QIE node gas estimates are unreliable; set a safe floor (only gas used is charged)
    chain: null as any,
  });
  const pc = await publicClient(env);
  const receipt = await pc.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("cancelInvoice tx failed: " + hash);
  return { txHash: hash };
}

export async function attestIdentity(env: Env, user: `0x${string}`, name: string): Promise<`0x${string}`> {
  const c = await getContracts(env);
  if (!c) throw new Error("Contracts not deployed");
  const key = await getOperatorKey(env);
  if (!key) throw new Error("Operator key unavailable");
  const wc = await walletClient(env, key);
  const hash = await wc.writeContract({
    address: c.identityRegistry,
    abi: IdentityRegistry.abi as any,
    functionName: "attest",
    args: [user, name],
    gas: 300000n, // QIE node gas estimates are unreliable; set a safe floor (only gas used is charged)
    chain: null as any,
  });
  const pc = await publicClient(env);
  const receipt = await pc.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("attest tx failed: " + hash);
  return hash;
}

/**
 * Demo faucet: forward native QIE from the operator to a payer so they can pay
 * an invoice. Rate-limited once per address per 24h (KV), and guarded by an
 * operator balance reserve so we never drain the gas fund.
 *
 * `amountHuman` is the invoice amount in QIE; we add a small gas buffer, cap at
 * 2 QIE, and refuse if the operator would drop below a 1.5 QIE reserve.
 */
export async function fundPayer(env: Env, to: `0x${string}`, amountHuman: number): Promise<{ txHash: `0x${string}`; sent: string }> {
  const key = await getOperatorKey(env);
  if (!key) throw new Error("Operator key unavailable");
  const wc = await walletClient(env, key);
  const { parseEther, formatEther } = await import("viem");

  // Rate limit: once per address per 24h
  const rlKey = `faucet:${to.toLowerCase()}`;
  const last = await env.CONFIG.get(rlKey);
  if (last) throw new Error("This address already received test QIE from the faucet in the last 24h. Use the official faucet for more: https://www.qie.digital/faucet");

  const needed = parseEther(String(amountHuman)) + parseEther("0.05"); // amount + gas buffer
  const cap = parseEther("2");
  const send = needed > cap ? cap : needed;

  // Reserve guard
  const op = (await ensureOperator(env)).address as `0x${string}`;
  const pc = await publicClient(env);
  const bal = await pc.getBalance({ address: op });
  const reserve = parseEther("1.5");
  if (bal - send < reserve) throw new Error("Faucet reserve reached. Please fund via the official QIE faucet: https://www.qie.digital/faucet");

  const hash = await wc.sendTransaction({
    to,
    value: send,
    gas: 300000n, // safe floor; only gas used is charged
    chain: null as any,
  });
  const receipt = await pc.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("faucet transfer failed: " + hash);
  await env.CONFIG.put(rlKey, String(Date.now()), { expirationTtl: 86400 });
  return { txHash: hash, sent: formatEther(send) };
}

// ---- Reads ----

export interface OnChainInvoice {
  creator: string;
  amount: bigint;
  paid: boolean;
  paidAt: bigint;
  payer: string;
}

export async function getInvoice(env: Env, invoiceId: bigint | number): Promise<OnChainInvoice | null> {
  const c = await getContracts(env);
  if (!c) return null;
  const pc = await publicClient(env);
  try {
    const res = (await pc.readContract({
      address: c.invoiceRegistry,
      abi: InvoiceRegistry.abi as any,
      functionName: "getInvoice",
      args: [BigInt(invoiceId)],
    })) as [string, bigint, boolean, bigint, string];
    return {
      creator: res[0],
      amount: res[1],
      paid: res[2],
      paidAt: res[3],
      payer: res[4],
    };
  } catch {
    return null;
  }
}

export async function isPaid(env: Env, invoiceId: bigint | number): Promise<boolean> {
  const c = await getContracts(env);
  if (!c) return false;
  const pc = await publicClient(env);
  try {
    return (await pc.readContract({
      address: c.invoiceRegistry,
      abi: InvoiceRegistry.abi as any,
      functionName: "isPaid",
      args: [BigInt(invoiceId)],
    })) as boolean;
  } catch {
    return false;
  }
}

export async function isVerified(env: Env, addr: `0x${string}`): Promise<{ verified: boolean; name: string }> {
  const c = await getContracts(env);
  if (!c) return { verified: false, name: "" };
  const pc = await publicClient(env);
  try {
    const res = (await pc.readContract({
      address: c.identityRegistry,
      abi: IdentityRegistry.abi as any,
      functionName: "getIdentity",
      args: [addr],
    })) as [string, boolean, bigint];
    return { name: res[0], verified: res[1] };
  } catch {
    return { verified: false, name: "" };
  }
}

export async function nativeBalance(env: Env, addr: `0x${string}`): Promise<bigint> {
  const pc = await publicClient(env);
  try {
    return await pc.getBalance({ address: addr });
  } catch {
    return 0n;
  }
}

// ---- Payment confirmation ----

export async function verifyPaymentTx(
  env: Env,
  invoiceId: bigint | number,
  txHash: `0x${string}`
): Promise<{ ok: boolean; paid: boolean; payer: string | null; reason?: string }> {
  const c = await getContracts(env);
  if (!c) return { ok: false, paid: false, payer: null, reason: "Contracts not deployed" };
  const pc = await publicClient(env);
  try {
    const receipt = await pc.getTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") return { ok: true, paid: false, payer: null, reason: "tx reverted" };
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== c.invoiceRegistry.toLowerCase()) continue;
      try {
        const { decodeEventLog } = await import("viem");
        const decoded: any = decodeEventLog({
          abi: InvoiceRegistry.abi as any,
          data: log.data,
          topics: log.topics as any,
        });
        if (decoded.eventName === "Paid") {
          const args = decoded.args as { id: bigint; payer: string; amount: bigint };
          if (args.id === BigInt(invoiceId)) {
            return { ok: true, paid: true, payer: args.payer };
          }
        }
      } catch {
        // not our event
      }
    }
    return { ok: true, paid: false, payer: null, reason: "Paid event not found for this invoice" };
  } catch (e) {
    return { ok: false, paid: false, payer: null, reason: e instanceof Error ? e.message : "rpc error" };
  }
}

/**
 * Verify a direct native-QIE transfer to the invoice's creator.
 * Accepts a plain tx that sends exactly `amount` QIE to `creator_address`.
 * No registry interaction required — works from any wallet (mobile included).
 */
export async function verifyDirectTransferTx(
  env: Env,
  creatorAddress: string,
  amountHuman: number,
  txHash: `0x${string}`
): Promise<{ ok: boolean; paid: boolean; payer: string | null; reason?: string }> {
  const pc = await publicClient(env);
  try {
    const tx = await pc.getTransaction({ hash: txHash });
    if (!tx || !tx.to) return { ok: true, paid: false, payer: null, reason: "tx has no recipient" };
    if (tx.to.toLowerCase() !== creatorAddress.toLowerCase()) {
      return { ok: true, paid: false, payer: null, reason: "tx sent to wrong address (not the merchant)" };
    }
    const { parseEther } = await import("viem");
    const expected = parseEther(String(amountHuman));
    if (tx.value !== expected) {
      return { ok: true, paid: false, payer: null, reason: `wrong amount: sent ${tx.value} wei, expected ${expected} wei` };
    }
    const receipt = await pc.getTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") return { ok: true, paid: false, payer: null, reason: "tx reverted" };
    const payer = tx.from || (receipt.from as string) || null;
    return { ok: true, paid: true, payer };
  } catch (e) {
    return { ok: false, paid: false, payer: null, reason: e instanceof Error ? e.message : "rpc error" };
  }
}

async function extractInvoiceId(logs: any[], registry: string): Promise<bigint | null> {
  const { decodeEventLog } = await import("viem");
  for (const log of logs) {
    if (log.address.toLowerCase() !== registry.toLowerCase()) continue;
    try {
      const decoded: any = decodeEventLog({
        abi: InvoiceRegistry.abi as any,
        data: log.data,
        topics: log.topics as any,
      });
      if (decoded.eventName === "InvoiceCreated") {
        return (decoded.args as { id: bigint }).id;
      }
    } catch {
      /* not our event */
    }
  }
  return null;
}

// Alias used by the router (index.ts) to avoid clashing with db.getInvoice.
export { getInvoice as getInvoiceOnChain };
