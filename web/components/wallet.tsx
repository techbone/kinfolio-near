"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LogOut, Wallet } from "lucide-react";
import { CONTRACT_ID, TGAS } from "@/lib/config";

type Connector = import("@hot-labs/near-connect").NearConnector;

interface CallResult {
  txHash: string;
}

interface WalletState {
  accountId: string | null;
  ready: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  /** Signs and sends a function call to the Kinfolio contract through the connected wallet. */
  call: (method: string, args: Record<string, unknown>, gasTgas?: number) => Promise<CallResult>;
}

const Ctx = createContext<WalletState | null>(null);

export function useWallet(): WalletState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet outside WalletProvider");
  return v;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const connector = useRef<Connector | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { NearConnector } = await import("@hot-labs/near-connect");
      if (cancelled) return;
      const c = new NearConnector({ network: "testnet", features: { testnet: true } });
      connector.current = c;
      c.on("wallet:signIn", (t) => setAccountId(t.accounts[0]?.accountId ?? null));
      c.on("wallet:signOut", () => setAccountId(null));
      await c.whenManifestLoaded;
      try {
        const { accounts } = await c.getConnectedWallet();
        setAccountId(accounts[0]?.accountId ?? null);
      } catch {
        /* not signed in */
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const connect = useCallback(async () => {
    await connector.current?.connect();
  }, []);

  const disconnect = useCallback(async () => {
    await connector.current?.disconnect();
    setAccountId(null);
  }, []);

  const call = useCallback(async (method: string, args: Record<string, unknown>, gasTgas = 100) => {
    if (!connector.current) throw new Error("Wallet is still loading");
    const wallet = await connector.current.wallet();
    const result = await wallet.signAndSendTransaction({
      receiverId: CONTRACT_ID,
      actions: [{ type: "FunctionCall", params: { methodName: method, args, gas: TGAS(gasTgas), deposit: "0" } }],
    });
    return { txHash: (result as { transaction: { hash: string } }).transaction.hash };
  }, []);

  const value = useMemo(() => ({ accountId, ready, connect, disconnect, call }), [accountId, ready, connect, disconnect, call]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function WalletButton() {
  const { accountId, ready, connect, disconnect } = useWallet();
  if (!ready) return <div className="h-8 w-28 rounded-control border border-border" aria-hidden />;
  if (!accountId) {
    return (
      <button
        onClick={connect}
        className="inline-flex h-8 items-center gap-2 rounded-control bg-accent px-3 text-sm font-medium text-accent-fg hover:opacity-90"
      >
        <Wallet size={16} strokeWidth={1.5} />
        Connect wallet
      </button>
    );
  }
  return (
    <button
      onClick={disconnect}
      title="Disconnect"
      className="num inline-flex h-8 items-center gap-2 rounded-control border border-border px-3 text-xs hover:bg-surface"
    >
      {accountId}
      <LogOut size={14} strokeWidth={1.5} className="text-muted" />
    </button>
  );
}
