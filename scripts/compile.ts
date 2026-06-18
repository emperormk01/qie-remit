/**
 * Compile QIE Remit Solidity contracts with solcjs and emit artifacts
 * (abi + bytecode) to src/artifacts/*.json. The Worker imports these to deploy
 * and interact with the contracts.
 *
 *   bun scripts/compile.ts
 */
import solc from "solc";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const CONTRACTS = join(ROOT, "contracts");
const OUT = join(ROOT, "src", "artifacts");

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const FILES = {
  "interfaces/IERC20.sol": join(CONTRACTS, "interfaces", "IERC20.sol"),
  "MockQUSDC.sol": join(CONTRACTS, "MockQUSDC.sol"),
  "IdentityRegistry.sol": join(CONTRACTS, "IdentityRegistry.sol"),
  "InvoiceRegistry.sol": join(CONTRACTS, "InvoiceRegistry.sol"),
};

function findImports(path: string): { contents?: string; error?: string } {
  try {
    let abs: string;
    if (path.startsWith("./") || path.startsWith("../")) {
      abs = join(CONTRACTS, path);
    } else if (existsSync(join(CONTRACTS, path))) {
      abs = join(CONTRACTS, path);
    } else if (existsSync(path)) {
      abs = path;
    } else {
      return { error: `File not found: ${path}` };
    }
    return { contents: readFileSync(abs, "utf8") };
  } catch (e: any) {
    return { error: `Error reading ${path}: ${e.message}` };
  }
}

const input = {
  language: "Solidity",
  sources: Object.fromEntries(
    Object.entries(FILES).map(([k, v]) => [k, { urls: [v] }]),
  ),
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "paris", // QIE testnet EVM is pre-Shanghai; avoid MCOPY (opcode 0x5e)
    outputSelection: {
      "*": {
        "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"],
      },
    },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));

if (output.errors) {
  for (const e of output.errors) {
    console[e.severity === "error" ? "error" : "log"](`${e.severity}: ${e.formattedMessage || e.message}`);
  }
  const hasError = output.errors.some((e: any) => e.severity === "error");
  if (hasError) {
    console.error("\nCompilation failed.");
    process.exit(1);
  }
}

const contracts = output.contracts || {};
let written = 0;
for (const [file, entries] of Object.entries(contracts)) {
  for (const [name, data] of Object.entries(entries as any)) {
    const artifact = {
      contractName: name,
      abi: data.abi,
      bytecode: "0x" + (data.evm?.bytecode?.object || ""),
    };
    const outPath = join(OUT, `${name}.json`);
    writeFileSync(outPath, JSON.stringify(artifact, null, 2));
    console.log(`  wrote ${outPath} (abi: ${data.abi.length}, bytecode: ${artifact.bytecode.length} chars)`);
    written++;
  }
}
console.log(`\nCompiled ${written} contract(s) -> ${OUT}`);
