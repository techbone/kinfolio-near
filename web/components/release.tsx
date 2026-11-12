"use client";

import { useState } from "react";
import { BASESCAN, MEMPOOL_WEB } from "@/lib/config";
import * as btcApi from "@/lib/btc";
import * as evm from "@/lib/evm";
import { eth, pct, sats } from "@/lib/format";
import { getLastSigned, getLastSignedEvm } from "@/lib/near";
import type { SignedTx, Trust } from "@/lib/types";
import { Button, Card, Field, Steps, inputClass, type Step } from "./ui";
import { useWallet } from "./wallet";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Polls a signed-tx view until it shows a signature newer than `before`. */
async function waitForSignature(read: () => Promise<SignedTx | null>, before: number): Promise<SignedTx> {
  for (let i = 0; i < 60; i++) {
    const s = await read();
    if (s && s.signed_at_secs > before) return s;
    await sleep(2000);
  }
  throw new Error("The MPC network did not return a signature in time. Check the transaction on the NEAR explorer.");
}

function useSteps(labels: string[]) {
  const [steps, setSteps] = useState<Step[] | null>(null);
  const start = () => setSteps(labels.map((label) => ({ label, status: "idle" as const })));
  const set = (i: number, patch: Partial<Step>) =>
    setSteps((prev) => (prev ? prev.map((s, j) => (j === i ? { ...s, ...patch } : s)) : prev));
  return { steps, start, set };
}

/** An heir sets where their share is paid. */
export function SetPayout({ trust, accountId, refresh }: { trust: Trust; accountId: string; refresh: () => Promise<void> }) {
  const { call } = useWallet();
  const me = trust.heirs.find((h) => h.account === accountId)!;
  const [btcAddr, setBtcAddr] = useState(me.btc_address ?? "");
  const [evmAddr, setEvmAddr] = useState(me.evm_address ?? "");
  const [status, setStatus] = useState<{ tone: "muted" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const btcOk = btcAddr === "" || /^tb1q[02-9ac-hj-np-z]{38}$/.test(btcAddr);
  const evmOk = evmAddr === "" || /^0x[0-9a-fA-F]{40}$/.test(evmAddr);
  const changed = btcAddr !== (me.btc_address ?? "") || evmAddr !== (me.evm_address ?? "");

  const save = async () => {
    setBusy(true);
    setStatus({ tone: "muted", text: "Approve in your wallet, then waiting for NEAR to execute…" });
    try {
      await call("set_payout", { id: trust.id, btc_address: btcAddr || null, evm_address: evmAddr || null });
      await refresh();
      setStatus({ tone: "muted", text: "Saved on-chain." });
    } catch (e) {
      setStatus({ tone: "danger", text: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Your payout addresses">
      <p className="mb-4 text-muted">
        You receive {pct(me.bps)} of what the trust holds once it is released. The contract pays only the addresses saved here.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Bitcoin testnet4 (tb1q…)" hint={btcOk ? undefined : "Native segwit testnet address, 42 characters"}>
          <input className={inputClass} value={btcAddr} onChange={(e) => setBtcAddr(e.target.value.trim())} placeholder="tb1q…" />
        </Field>
        <Field label="Base Sepolia (0x…)" hint={evmOk ? undefined : "0x followed by 40 hex characters"}>
          <input className={inputClass} value={evmAddr} onChange={(e) => setEvmAddr(e.target.value.trim())} placeholder="0x…" />
        </Field>
      </div>
      <div className="mt-4 flex items-center gap-4">
        <Button disabled={busy || !changed || !btcOk || !evmOk} onClick={save}>
          Save payout addresses
        </Button>
        {status && <p className={`text-xs ${status.tone === "danger" ? "text-danger" : "text-muted"}`}>{status.text}</p>}
      </div>
    </Card>
  );
}

/** After release: anyone can ask the contract to sign the payouts and broadcast them. */
export function Distribute({ trust, accountId, connect }: { trust: Trust; accountId: string | null; connect: () => Promise<void> }) {
  const missingBtc = trust.heirs.filter((h) => !h.btc_address).map((h) => h.account);
  const missingEvm = trust.heirs.filter((h) => !h.evm_address).map((h) => h.account);

  return (
    <Card title="Pay the heirs">
      <p className="mb-4 text-muted">
        The trust is released. Anyone can trigger the payout: the contract builds each transaction from its own heir list and shares, and the MPC network signs it. Whoever presses the button can&apos;t change who gets paid.
      </p>
      {!accountId ? (
        <div className="flex items-center justify-between gap-4">
          <p className="text-muted">Connect any NEAR testnet wallet to pay the NEAR gas for this step.</p>
          <Button onClick={connect}>Connect wallet</Button>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          <PayBtc trust={trust} missing={missingBtc} />
          <PayEvm trust={trust} missing={missingEvm} />
        </div>
      )}
    </Card>
  );
}

function Missing({ who, chain }: { who: string[]; chain: string }) {
  return (
    <p className="text-xs text-warn">
      Waiting for {who.join(", ")} to set a {chain} payout address.
    </p>
  );
}

function PayBtc({ trust, missing }: { trust: Trust; missing: string[] }) {
  const { call } = useWallet();
  const { steps, start, set } = useSteps([
    "Collect the trust's UTXOs and a fee",
    "Contract builds one output per heir; the MPC network signs",
    "Broadcast to Bitcoin testnet4",
    "Seen on the network",
  ]);
  const [paid, setPaid] = useState<{ account: string; value: number }[] | null>(null);

  const pay = async () => {
    start();
    setPaid(null);
    let step = 0;
    try {
      set(0, { status: "active" });
      const [utxos, rate] = await Promise.all([btcApi.fetchUtxos(trust.btc_address!), btcApi.feeRate()]);
      const picked = [...utxos].sort((a, b) => b.value - a.value).slice(0, 3);
      if (!picked.length) throw new Error("The trust holds no bitcoin.");
      const total = picked.reduce((s, u) => s + u.value, 0);
      const fee = Math.ceil(rate * btcApi.vsize(picked.length, trust.heirs.length));
      set(0, { status: "done", detail: `${picked.length} input(s), ${sats(total)} sats, fee ${sats(fee)} sats` });

      step = 1;
      set(1, { status: "active", detail: "Approve in your wallet, then wait for the MPC network (a few blocks)." });
      const before = (await getLastSigned(trust.id))?.signed_at_secs ?? 0;
      await call("distribute_btc", { id: trust.id, utxos: picked.map(({ txid, vout, value }) => ({ txid, vout, value })), fee_sats: fee }, 300);
      const signed = await waitForSignature(() => getLastSigned(trust.id), before);
      set(1, { status: "done", detail: <span className="num">txid {signed.txid}</span> });

      step = 2;
      set(2, { status: "active" });
      await btcApi.broadcast(signed.raw_hex);
      set(2, {
        status: "done",
        detail: (
          <a className="num text-accent underline" href={`${MEMPOOL_WEB}/tx/${signed.txid}`} target="_blank" rel="noreferrer">
            {signed.txid.slice(0, 16)}… on mempool.space
          </a>
        ),
      });

      step = 3;
      set(3, { status: "active" });
      for (let i = 0; i < 30; i++) {
        const tx = await btcApi.fetchTx(signed.txid).catch(() => null);
        if (tx) {
          const byAddr = new Map(trust.heirs.map((h) => [h.btc_address, h.account]));
          setPaid(tx.vout.map((o) => ({ account: byAddr.get(o.scriptpubkey_address) ?? o.scriptpubkey_address, value: o.value })));
          set(3, { status: "done", detail: "In the mempool, awaiting a block" });
          return;
        }
        await sleep(2000);
      }
      throw new Error("Broadcast accepted but the transaction is not visible yet.");
    } catch (e) {
      set(step, { status: "error", detail: <span className="text-danger">{errText(e)}</span> });
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">Bitcoin testnet4</h3>
      {missing.length ? <Missing who={missing} chain="Bitcoin" /> : <Button onClick={pay}>Pay heirs in BTC</Button>}
      {steps && <Steps steps={steps} />}
      {paid && <PaidTable rows={paid.map((p) => ({ account: p.account, amount: `${sats(p.value)} sats` }))} />}
    </div>
  );
}

function PayEvm({ trust, missing }: { trust: Trust; missing: string[] }) {
  const { call } = useWallet();
  const { steps, start, set } = useSteps([
    "Read nonce, gas price and balance on Base Sepolia",
    "Contract builds the split() call; the MPC network signs",
    "Broadcast to Base Sepolia",
    "Confirmed: the splitter paid each heir",
  ]);

  const pay = async () => {
    start();
    let step = 0;
    try {
      set(0, { status: "active" });
      const params = await evm.payoutParams(trust.evm_address!);
      if (!params) throw new Error("The trust's ETH balance doesn't cover gas.");
      set(0, { status: "done", detail: `${eth(BigInt(params.value_wei))} ETH to split, nonce ${params.nonce}` });

      step = 1;
      set(1, { status: "active", detail: "Approve in your wallet, then wait for the MPC network (a few blocks)." });
      const before = (await getLastSignedEvm(trust.id))?.signed_at_secs ?? 0;
      await call("distribute_evm", { id: trust.id, ...params }, 100);
      const signed = await waitForSignature(() => getLastSignedEvm(trust.id), before);
      set(1, { status: "done", detail: <span className="num">tx {signed.txid.slice(0, 18)}…</span> });

      step = 2;
      set(2, { status: "active" });
      const hash = await evm.sendRaw(signed.raw_hex);
      const link = (
        <a className="num text-accent underline" href={`${BASESCAN}/tx/${hash}`} target="_blank" rel="noreferrer">
          {hash.slice(0, 18)}… on BaseScan
        </a>
      );
      set(2, { status: "done", detail: link });

      step = 3;
      set(3, { status: "active" });
      for (let i = 0; i < 30; i++) {
        const r = await evm.receipt(hash).catch(() => null);
        if (r) {
          if (r.status !== "0x1") throw new Error("The split transaction reverted.");
          set(3, { status: "done", detail: link });
          return;
        }
        await sleep(2000);
      }
      throw new Error("Broadcast accepted but no receipt yet.");
    } catch (e) {
      set(step, { status: "error", detail: <span className="text-danger">{errText(e)}</span> });
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">Base Sepolia</h3>
      {missing.length ? <Missing who={missing} chain="Base Sepolia" /> : <Button onClick={pay}>Pay heirs in ETH</Button>}
      {steps && <Steps steps={steps} />}
    </div>
  );
}

function PaidTable({ rows }: { rows: { account: string; amount: string }[] }) {
  return (
    <table className="w-full text-left text-[13px]">
      <tbody>
        {rows.map((r) => (
          <tr key={r.account} className="border-t border-border">
            <td className="num py-1.5">{r.account}</td>
            <td className="num py-1.5 text-right">{r.amount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
