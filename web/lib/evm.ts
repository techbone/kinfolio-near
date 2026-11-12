import { BASE_RPC } from "./config";

/** OP-stack GasPriceOracle predeploy; `getL1FeeUpperBound(uint256)` is selector 0xf1c7a58b. */
const L1_FEE_ORACLE = "0x420000000000000000000000000000000000000F";
const GAS_LIMIT = 120_000n;
const PRIORITY_FEE = 1_000_000n; // 0.001 gwei; Base Sepolia blocks are rarely full

export async function evmRpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(BASE_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result as T;
}

export const balanceWei = async (address: string) => BigInt(await evmRpc<string>("eth_getBalance", [address, "latest"]));

export interface PayoutParams {
  nonce: number;
  max_fee_per_gas: string;
  max_priority_fee_per_gas: string;
  gas_limit: number;
  value_wei: string;
}

/**
 * Arguments for `distribute_evm` that send the whole balance through the splitter. Base is an
 * OP-stack L2, so on top of L2 gas every tx pays an L1 data fee; we reserve the oracle's upper
 * bound for it, and the few wei left over stay in the trust.
 */
export async function payoutParams(trustAddress: string): Promise<PayoutParams | null> {
  const [balance, nonceHex, block, l1Hex] = await Promise.all([
    balanceWei(trustAddress),
    evmRpc<string>("eth_getTransactionCount", [trustAddress, "pending"]),
    evmRpc<{ baseFeePerGas: string }>("eth_getBlockByNumber", ["latest", false]),
    evmRpc<string>("eth_call", [{ to: L1_FEE_ORACLE, data: `0xf1c7a58b${(800).toString(16).padStart(64, "0")}` }, "latest"]),
  ]);
  const maxFee = BigInt(block.baseFeePerGas) * 2n + PRIORITY_FEE;
  const value = balance - GAS_LIMIT * maxFee - BigInt(l1Hex);
  if (value <= 0n) return null;
  return {
    nonce: Number(BigInt(nonceHex)),
    max_fee_per_gas: maxFee.toString(),
    max_priority_fee_per_gas: PRIORITY_FEE.toString(),
    gas_limit: Number(GAS_LIMIT),
    value_wei: value.toString(),
  };
}

export const sendRaw = (rawHex: string) => evmRpc<string>("eth_sendRawTransaction", [rawHex]);

export const receipt = (hash: string) => evmRpc<{ status: string } | null>("eth_getTransactionReceipt", [hash]);
