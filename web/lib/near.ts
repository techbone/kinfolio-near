import { CONTRACT_ID, NEAR_RPC, NEAR_RPC_FALLBACK } from "./config";
import type { SignedTx, Trust } from "./types";

/** JSON-RPC to NEAR. Moves to the fallback provider on network errors and rate limits only. */
async function rpc<T>(method: string, params: unknown): Promise<T> {
  let last: unknown;
  for (const url of [NEAR_RPC, NEAR_RPC_FALLBACK]) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "kinfolio", method, params }),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`NEAR RPC ${res.status}`);
      const body = await res.json();
      if (body.error?.code === -429) throw new Error("NEAR RPC rate limited");
      if (body.error) return Promise.reject(new Error(body.error.data ?? body.error.message ?? "NEAR RPC error"));
      return body.result as T;
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

export async function view<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await rpc<{ result: number[]; error?: string }>("query", {
    request_type: "call_function",
    finality: "optimistic",
    account_id: CONTRACT_ID,
    method_name: method,
    args_base64: btoa(JSON.stringify(args)),
  });
  if (result.error) throw new Error(result.error);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(result.result))) as T;
}

export const getTrust = (id: number) => view<Trust | null>("get_trust", { id });
export const trustsOf = (owner: string) => view<Trust[]>("trusts_of", { owner });
export const trustsFor = (heir: string) => view<Trust[]>("trusts_for", { heir });
export const getLastSigned = (id: number) => view<SignedTx | null>("get_last_signed", { id });

/** Final status of a transaction, from the chain, for the "confirmed" step. */
export async function txStatus(txHash: string, signer: string): Promise<{ ok: boolean; failure?: string }> {
  const res = await rpc<{ status: { SuccessValue?: string; Failure?: unknown } }>("tx", [txHash, signer]);
  if (res.status.Failure) return { ok: false, failure: JSON.stringify(res.status.Failure) };
  return { ok: true };
}
export const getLastSignedEvm = (id: number) => view<SignedTx | null>("get_last_signed_evm", { id });
