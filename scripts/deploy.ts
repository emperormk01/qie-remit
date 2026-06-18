/**
 * Deploy QIE Remit contracts to QIE Testnet (chain 1983) using viem.
 *
 * Requires a funded deployer private key. Set via:
 *   DEPLOYER_PRIVATE_KEY=0x... bun scripts/deploy.ts
 *
 * Prints the deployed contract addresses. Store them in the Worker CONFIG KV
 * under key "contracts" (the /admin/deploy endpoint does this automatically
 * when run from the Worker; this script is the local/offline alternative).
 */
import {
  createWalletClient,
  http,
  parseEther,
  encodeDeployData,
  keccak256,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const RPC = process.env.QIE_RPC || "https://rpc1testnet.qie.digital/";
const CHAIN_ID = Number(process.env.QIE_CHAIN_ID || 1983);
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY;

if (!DEPLOYER_KEY || !DEPLOYER_KEY.startsWith("0x")) {
  console.error("Set DEPLOYER_PRIVATE_KEY (0x-prefixed).");
  process.exit(1);
}

const ART = join(resolve(import.meta.dir, ".."), "src", "artifacts");
function load(name: string) {
  return JSON.parse(readFileSync(join(ART, `${name}.json`), "utf8"));
}
const qusdcArt = load("MockQUSDC");
const idArt = load("IdentityRegistry");
const invArt = load("InvoiceRegistry");

// QIE testnet as a custom viem chain
const qieTestnet = {
  id: CHAIN_ID,
  name: "QIE Testnet",
  nativeCurrency: { name: "QIE", symbol: "QIE", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
} as const;

const account = privateKeyToAccount(DEPLOYER_KEY as `0x${string}`);
const client = createWalletClient({
  account,
  chain: qieTestnet,
  transport: http(RPC, { timeout: 60_000 }),
});

async function deploy(name: string, abi: any, bytecode: `0x${string}`) {
  const hash = await client.deployContract({ abi, bytecode, args: [] });
  console.log(`  ${name}: tx ${hash}`);
  // poll receipt via raw RPC
  let receipt: any = null;
  for (let i = 0; i < 60 && !receipt; i++) {
    const r = await fetch(RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [hash] }),
    }).then((x) => x.json());
    receipt = r.result;
    if (!receipt) await new Promise((r) => setTimeout(r, 1500));
  }
  if (!receipt || !receipt.contractAddress) {
    throw new Error(`No contract address for ${name}`);
  }
  console.log(`  ${name}: deployed at ${receipt.contractAddress} (block ${Number(receipt.blockNumber)})`);
  return receipt.contractAddress as `0x${string}`;
}

(async () => {
  console.log(`Deploying to QIE Testnet (chain ${CHAIN_ID}) from ${account.address} via ${RPC}\n`);
  const qusdc = await deploy("MockQUSDC", qusdcArt.abi, qusdcArt.bytecode);
  const identity = await deploy("IdentityRegistry", idArt.abi, idArt.bytecode);
  const invoice = await deploy("InvoiceRegistry", invArt.abi, invArt.bytecode);

  const contracts = {
    qusdc,
    identity,
    invoice,
    chainId: CHAIN_ID,
    rpc: RPC,
    deployer: account.address,
    deployedAt: Date.now(),
  };
  console.log("\n=== Deployed contracts ===");
  console.log(JSON.stringify(contracts, null, 2));
  console.log('\nStore in Worker CONFIG KV key "contracts":');
  console.log(JSON.stringify(contracts));
})();
