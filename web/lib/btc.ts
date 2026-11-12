import { MEMPOOL_API, MEMPOOL_FALLBACK_API } from "./config";

export interface Utxo {
  txid: string;
  vout: number;
  value: number;
  status: { confirmed: boolean };
}

/** Esplora-compatible APIs, tried in order: mempool.space, then Blockstream if it's unreachable. */
const APIS = [MEMPOOL_API, MEMPOOL_FALLBACK_API];

async function esplora(path: string, init?: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (const base of APIS) {
    try {
      return await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(10_000) });
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

async function get<T>(path: string): Promise<T> {
  const res = await esplora(path);
  if (!res.ok) throw new Error(`esplora ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

export const fetchTx = (txid: string) =>
  get<{ vout: { scriptpubkey_address: string; value: number }[] }>(`/tx/${txid}`);

export const fetchUtxos = (address: string) => get<Utxo[]>(`/address/${address}/utxo`);

export async function fetchBalance(address: string): Promise<{ confirmed: number; pending: number }> {
  const a = await get<{
    chain_stats: { funded_txo_sum: number; spent_txo_sum: number };
    mempool_stats: { funded_txo_sum: number; spent_txo_sum: number };
  }>(`/address/${address}`);
  return {
    confirmed: a.chain_stats.funded_txo_sum - a.chain_stats.spent_txo_sum,
    pending: a.mempool_stats.funded_txo_sum - a.mempool_stats.spent_txo_sum,
  };
}

export async function feeRate(): Promise<number> {
  const f = await get<{ hourFee: number }>(`/v1/fees/recommended`).catch(() => null);
  if (f) return Math.max(1, f.hourFee);
  // Blockstream exposes Esplora's /fee-estimates (sat/vB by confirmation target) instead.
  const est = await get<Record<string, number>>(`/fee-estimates`).catch(() => ({}) as Record<string, number>);
  return Math.max(1, Math.ceil(est["6"] ?? 1));
}

export async function broadcast(rawHex: string): Promise<string> {
  const res = await esplora(`/tx`, { method: "POST", body: rawHex });
  const text = await res.text();
  if (!res.ok) throw new Error(`broadcast rejected: ${text}`);
  return text.trim();
}

export async function confirmations(txid: string): Promise<{ seen: boolean; confirmed: boolean }> {
  const res = await esplora(`/tx/${txid}/status`).catch(() => null);
  if (!res) return { seen: false, confirmed: false };
  if (!res.ok) return { seen: false, confirmed: false };
  const s = (await res.json()) as { confirmed: boolean };
  return { seen: true, confirmed: s.confirmed };
}

/** Largest-first selection of at most `max` outputs that cover `target` sats. */
export function selectUtxos(utxos: Utxo[], target: number, max = 3): Utxo[] | null {
  const sorted = [...utxos].sort((a, b) => b.value - a.value).slice(0, max);
  const picked: Utxo[] = [];
  let sum = 0;
  for (const u of sorted) {
    picked.push(u);
    sum += u.value;
    if (sum >= target) return picked;
  }
  return null;
}

/** Virtual size of a P2WPKH spend with `inputs` inputs and `outputs` outputs. */
export const vsize = (inputs: number, outputs: number) => Math.ceil(10.5 + 68 * inputs + 31 * outputs);

export async function evmBalanceWei(rpcUrl: string, address: string): Promise<bigint> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [address, "latest"] }),
  });
  const body = await res.json();
  return BigInt(body.result ?? "0x0");
}
