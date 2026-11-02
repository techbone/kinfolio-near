"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { BASESCAN, BASE_RPC, MEMPOOL_WEB, NEAR_EXPLORER } from "@/lib/config";
import * as btcApi from "@/lib/btc";
import { btc, eth, pct, sats } from "@/lib/format";
import { getLastSigned, getTrust } from "@/lib/near";
import { useNow } from "@/lib/use-now";
import type { SignedTx, Trust } from "@/lib/types";
import { Timeline } from "./timeline";
import { Button, Card, Field, Mono, Steps, inputClass, type Step } from "./ui";
import { useWallet } from "./wallet";

const POLL_MS = 5000;

function useTrust(id: number) {
  const [trust, setTrust] = useState<Trust | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      setTrust(await getTrust(id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);
  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const t = setInterval(refresh, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [refresh]);
  return { trust, error, refresh };
}

export function TrustView({ id }: { id: number }) {
  const { trust, error, refresh } = useTrust(id);
  const { accountId } = useWallet();

  if (error && trust === undefined) {
    return (
      <Card>
        <p className="text-danger">Could not read the contract: {error}</p>
      </Card>
    );
  }
  if (trust === undefined) return <div className="h-64 animate-pulse rounded-card border border-border bg-surface" />;
  if (trust === null) {
    return (
      <Card>
        <p>No trust with id {id}.</p>
      </Card>
    );
  }

  const isOwner = accountId === trust.owner;
  const isHeir = !!accountId && trust.heirs.some((h) => h.account === accountId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="font-display text-3xl tracking-tight">Trust #{trust.id}</h1>
          <p className="mt-1 text-muted">
            Owned by <span className="num text-text">{trust.owner}</span>
            {isOwner && " (you)"}. Inactivity {trust.inactivity_secs}s, challenge window {trust.challenge_secs}s.
          </p>
        </div>
      </div>

      <Card title="Status">
        <Timeline trust={trust} />
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Holdings trust={trust} />
        <Heirs trust={trust} accountId={accountId} />
      </div>

      <Actions trust={trust} isOwner={isOwner} isHeir={isHeir} refresh={refresh} />
      {isOwner && trust.state === "Active" && trust.btc_address && <SpendBtc trust={trust} refresh={refresh} />}
      <LastSigned id={trust.id} />
    </div>
  );
}

function Holdings({ trust }: { trust: Trust }) {
  const [btcBal, setBtcBal] = useState<{ confirmed: number; pending: number } | null>(null);
  const [ethBal, setEthBal] = useState<bigint | null>(null);

  useEffect(() => {
    if (!trust.btc_address || !trust.evm_address) return;
    let live = true;
    const load = () => {
      btcApi.fetchBalance(trust.btc_address!).then((b) => live && setBtcBal(b)).catch(() => {});
      btcApi.evmBalanceWei(BASE_RPC, trust.evm_address!).then((b) => live && setEthBal(b)).catch(() => {});
    };
    load();
    const t = setInterval(load, 15000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [trust.btc_address, trust.evm_address]);

  if (!trust.btc_address || !trust.evm_address) {
    return (
      <Card title="Holdings">
        <Steps
          steps={[
            { label: "Trust created on NEAR", status: "done" },
            { label: "Waiting for the MPC network to derive this trust's keys", status: "active", detail: "Usually a few seconds." },
          ]}
        />
      </Card>
    );
  }

  return (
    <Card title="Holdings">
      <dl className="space-y-4">
        <div>
          <dt className="mb-1 flex items-center justify-between text-xs text-muted">
            <span>Bitcoin testnet4</span>
            <span className="num text-text">{btcBal ? `${btc(btcBal.confirmed)} BTC` : "…"}</span>
          </dt>
          <dd>
            <Mono value={trust.btc_address} href={`${MEMPOOL_WEB}/address/${trust.btc_address}`} />
            {btcBal && btcBal.pending !== 0 && (
              <div className="num mt-1 text-xs text-warn">{sats(btcBal.pending)} sats unconfirmed</div>
            )}
          </dd>
        </div>
        <div>
          <dt className="mb-1 flex items-center justify-between text-xs text-muted">
            <span>Base Sepolia (EVM)</span>
            <span className="num text-text">{ethBal !== null ? `${eth(ethBal)} ETH` : "…"}</span>
          </dt>
          <dd>
            <Mono value={trust.evm_address} href={`${BASESCAN}/address/${trust.evm_address}`} />
          </dd>
        </div>
      </dl>
      <p className="mt-4 border-t border-border pt-3 text-xs text-muted">
        These addresses are derived by the NEAR MPC network for this contract. Only this contract can authorize a signature for them.
      </p>
    </Card>
  );
}

function Heirs({ trust, accountId }: { trust: Trust; accountId: string | null }) {
  return (
    <Card title="Heirs">
      <table className="w-full text-left">
        <thead className="text-xs text-muted">
          <tr>
            <th className="pb-2 font-normal">Account</th>
            <th className="pb-2 text-right font-normal">Share</th>
          </tr>
        </thead>
        <tbody>
          {trust.heirs.map((h) => (
            <tr key={h.account} className="border-t border-border align-top">
              <td className="py-2">
                <span className="num text-[13px]">{h.account}</span>
                {accountId === h.account && <span className="ml-2 text-xs text-accent">you</span>}
                <div className="mt-0.5 text-xs text-muted">
                  {h.btc_address || h.evm_address ? "Payout address set" : "No payout address yet"}
                </div>
              </td>
              <td className="num py-2 text-right">{pct(h.bps)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function useAction(refresh: () => Promise<void>) {
  const { call } = useWallet();
  const [busy, setBusy] = useState<string | null>(null);
  const [tx, setTx] = useState<{ method: string; hash: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async (method: string, args: Record<string, unknown>) => {
    setBusy(method);
    setErr(null);
    try {
      const r = await call(method, args);
      setTx({ method, hash: r.txHash });
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  return { busy, tx, err, run };
}

function Actions({ trust, isOwner, isHeir, refresh }: { trust: Trust; isOwner: boolean; isHeir: boolean; refresh: () => Promise<void> }) {
  const { accountId, connect } = useWallet();
  const { busy, tx, err, run } = useAction(refresh);
  const now = useNow();

  const claimable = now !== null && now >= trust.claimable_after_secs;
  const finalizable = now !== null && trust.finalizable_after_secs !== null && now >= trust.finalizable_after_secs;
  const id = trust.id;

  return (
    <Card title="Actions">
      {!accountId ? (
        <div className="flex items-center justify-between gap-4">
          <p className="text-muted">Connect a NEAR testnet wallet to act as the owner or an heir.</p>
          <Button onClick={connect}>Connect wallet</Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {isOwner && trust.state === "Active" && (
              <Button variant="secondary" disabled={!!busy} onClick={() => run("heartbeat", { id })}>
                I&apos;m here (heartbeat)
              </Button>
            )}
            {isOwner && trust.state === "Challenge" && (
              <Button variant="danger" disabled={!!busy} onClick={() => run("veto", { id })}>
                Veto this claim
              </Button>
            )}
            {isHeir && trust.state === "Active" && (
              <Button disabled={!!busy || !claimable} onClick={() => run("start_claim", { id })}>
                Start claim
              </Button>
            )}
            {trust.state === "Challenge" && (
              <Button disabled={!!busy || !finalizable} onClick={() => run("finalize", { id })}>
                Finalize release
              </Button>
            )}
          </div>
          {!isOwner && !isHeir && <p className="text-muted">{accountId} is neither the owner nor an heir of this trust.</p>}
          {isHeir && trust.state === "Active" && !claimable && (
            <p className="text-xs text-muted">Claims open once the owner has been inactive for the full period.</p>
          )}
          {busy && <p className="text-xs text-muted">Waiting for {busy} to execute on NEAR…</p>}
          {err && (
            <p className="flex items-start gap-2 text-danger">
              <AlertTriangle size={16} strokeWidth={1.5} className="mt-0.5 shrink-0" />
              {err}
            </p>
          )}
          {tx && (
            <p className="text-xs text-muted">
              {tx.method} executed:{" "}
              <a className="num text-accent underline" href={`${NEAR_EXPLORER}/transactions/${tx.hash}`} target="_blank" rel="noreferrer">
                {tx.hash.slice(0, 12)}…
              </a>
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function SpendBtc({ trust, refresh }: { trust: Trust; refresh: () => Promise<void> }) {
  const { call } = useWallet();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("1000");
  const [steps, setSteps] = useState<Step[] | null>(null);

  const set = (i: number, patch: Partial<Step>) =>
    setSteps((prev) => (prev ? prev.map((s, j) => (j === i ? { ...s, ...patch } : s)) : prev));

  const labels = [
    "Pick inputs and a fee from the trust's UTXOs",
    "Contract builds the transaction; the MPC network signs it",
    "Broadcast to Bitcoin testnet4",
    "Seen on the network",
  ];

  const spend = async () => {
    const amountSats = Number(amount);
    setSteps(labels.map((label) => ({ label, status: "idle" as const })));
    let step = 0;
    try {
      set(0, { status: "active" });
      const [utxos, rate] = await Promise.all([btcApi.fetchUtxos(trust.btc_address!), btcApi.feeRate()]);
      const fee = Math.ceil(rate * btcApi.vsize(3, 2));
      const picked = btcApi.selectUtxos(utxos, amountSats + fee);
      if (!picked) throw new Error(`Not enough funds: need ${sats(amountSats + fee)} sats including fee; fund the BTC address above first.`);
      const exactFee = Math.ceil(rate * btcApi.vsize(picked.length, 2));
      const total = picked.reduce((s, u) => s + u.value, 0);
      const change = total - amountSats - exactFee;
      // The contract rejects dust change, so fold it into the fee instead of failing.
      const finalFee = change > 0 && change < 546 ? exactFee + change : exactFee;
      set(0, {
        status: "done",
        detail: `${picked.length} input(s), ${sats(total)} sats in, fee ${sats(finalFee)} sats (${rate} sat/vB)`,
      });

      step = 1;
      set(1, { status: "active", detail: "Approve in your wallet, then wait for the MPC network (a few blocks)." });
      const before = (await getLastSigned(trust.id))?.signed_at_secs ?? 0;
      await call(
        "owner_sign_btc",
        {
          id: trust.id,
          utxos: picked.map((u) => ({ txid: u.txid, vout: u.vout, value: u.value })),
          to,
          amount_sats: amountSats,
          fee_sats: finalFee,
        },
        200,
      );
      let signed: SignedTx | null = null;
      for (let i = 0; i < 60; i++) {
        const s = await getLastSigned(trust.id);
        if (s && s.signed_at_secs > before) {
          signed = s;
          break;
        }
        await sleep(2000);
      }
      if (!signed) throw new Error("The MPC network did not return a signature in time. Check the transaction on the NEAR explorer.");
      set(1, { status: "done", detail: <span className="num">txid {signed.txid}</span> });
      await refresh();

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
        const c = await btcApi.confirmations(signed.txid);
        if (c.seen) {
          set(3, { status: "done", detail: c.confirmed ? "Confirmed in a block" : "In the mempool, awaiting a block" });
          return;
        }
        await sleep(2000);
      }
      throw new Error("Broadcast accepted but the transaction is not visible yet.");
    } catch (e) {
      set(step, { status: "error", detail: <span className="text-danger">{e instanceof Error ? e.message : String(e)}</span> });
    }
  };

  const valid = to.startsWith("tb1q") && Number(amount) >= 546;

  return (
    <Card title="Spend Bitcoin from the trust">
      <p className="mb-4 text-muted">
        The contract builds the transaction itself: your destination, the change back to the trust, and a fee cap. A successful signature also counts as your heartbeat.
      </p>
      <div className="grid gap-3 sm:grid-cols-[1fr_160px_auto] sm:items-end">
        <Field label="Destination (testnet4 bech32, tb1q…)">
          <input className={inputClass} value={to} onChange={(e) => setTo(e.target.value.trim())} placeholder="tb1q…" />
        </Field>
        <Field label="Amount (sats)">
          <input className={inputClass} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} />
        </Field>
        <Button disabled={!valid} onClick={spend}>
          Sign and send
        </Button>
      </div>
      {steps && (
        <div className="mt-5 border-t border-border pt-4">
          <Steps steps={steps} />
        </div>
      )}
    </Card>
  );
}

function LastSigned({ id }: { id: number }) {
  const [signed, setSigned] = useState<SignedTx | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => getLastSigned(id).then((s) => live && setSigned(s)).catch(() => {});
    load();
    const t = setInterval(load, POLL_MS * 2);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [id]);
  if (!signed) return null;
  return (
    <Card title="Last transaction signed by this trust">
      <dl className="grid gap-2 sm:grid-cols-[120px_1fr]">
        <dt className="text-muted">Chain</dt>
        <dd className="num">{signed.chain}</dd>
        <dt className="text-muted">Txid</dt>
        <dd>
          <Mono value={signed.txid} href={`${MEMPOOL_WEB}/tx/${signed.txid}`} />
        </dd>
        <dt className="text-muted">Signed at</dt>
        <dd className="num">{new Date(signed.signed_at_secs * 1000).toISOString().replace("T", " ").slice(0, 19)} UTC</dd>
      </dl>
    </Card>
  );
}
