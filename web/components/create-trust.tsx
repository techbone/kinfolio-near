"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { getTrust, trustsOf } from "@/lib/near";
import { Button, Card, Field, Steps, inputClass, type Step } from "./ui";
import { useWallet } from "./wallet";

const PRESETS = [
  { label: "Demo timers", inactivity: 120, challenge: 60, note: "2 min inactivity, 1 min challenge" },
  { label: "Real timers", inactivity: 90 * 86400, challenge: 14 * 86400, note: "90 days inactivity, 14 day challenge" },
];

interface Row {
  account: string;
  percent: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function CreateTrust() {
  const { accountId, call } = useWallet();
  const router = useRouter();
  const [preset, setPreset] = useState(0);
  const [rows, setRows] = useState<Row[]>([
    { account: "", percent: "60" },
    { account: "", percent: "40" },
  ]);
  const [steps, setSteps] = useState<Step[] | null>(null);

  const total = rows.reduce((s, r) => s + (Number(r.percent) || 0), 0);
  const filled = rows.every((r) => /^[a-z0-9._-]+\.(testnet|near)$|^[0-9a-f]{64}$/.test(r.account) && Number(r.percent) > 0);
  const named = rows.map((r) => r.account).filter(Boolean);
  const unique = new Set(named).size === named.length;
  const valid = filled && unique && Math.abs(total - 100) < 1e-9;

  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const submit = async () => {
    if (!accountId) return;
    const set = (i: number, patch: Partial<Step>) => setSteps((p) => (p ? p.map((s, j) => (j === i ? { ...s, ...patch } : s)) : p));
    setSteps([
      { label: "Create the trust on NEAR", status: "active", detail: "Approve in your wallet." },
      { label: "MPC network derives the trust's BTC and EVM keys", status: "idle" },
    ]);
    let step = 0;
    try {
      const before = new Set((await trustsOf(accountId)).map((t) => t.id));
      const p = PRESETS[preset];
      await call("create_trust", {
        inactivity_secs: p.inactivity,
        challenge_secs: p.challenge,
        heirs: rows.map((r) => ({ account: r.account, bps: Math.round(Number(r.percent) * 100) })),
      });
      const created = (await trustsOf(accountId)).find((t) => !before.has(t.id));
      if (!created) throw new Error("The trust was not created; the contract rejected it or the derivation failed.");
      set(0, { status: "done", detail: `Trust #${created.id}` });
      step = 1;
      set(1, { status: "active" });
      for (let i = 0; i < 30; i++) {
        const t = await getTrust(created.id);
        if (t?.btc_address) {
          set(1, { status: "done", detail: t.btc_address });
          router.push(`/trust/${created.id}`);
          return;
        }
        await sleep(2000);
      }
      throw new Error("Key derivation is taking longer than expected.");
    } catch (e) {
      set(step, { status: "error", detail: <span className="text-danger">{e instanceof Error ? e.message : String(e)}</span> });
    }
  };

  return (
    <Card title="New trust">
      <div className="space-y-5">
        <div>
          <span className="mb-2 block text-xs font-medium text-muted">Timers</span>
          <div className="grid gap-2 sm:grid-cols-2">
            {PRESETS.map((p, i) => (
              <button
                key={p.label}
                onClick={() => setPreset(i)}
                className={`rounded-control border px-3 py-2 text-left ${preset === i ? "border-accent" : "border-border hover:bg-bg"}`}
              >
                <div className="text-sm font-medium">{p.label}</div>
                <div className="text-xs text-muted">{p.note}</div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="mb-2 block text-xs font-medium text-muted">Heirs (NEAR accounts; shares must total 100%)</span>
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_88px_36px] gap-2">
                <input
                  className={inputClass}
                  placeholder="heir.testnet"
                  value={r.account}
                  onChange={(e) => update(i, { account: e.target.value.trim().toLowerCase() })}
                  aria-label={`Heir ${i + 1} account`}
                />
                <div className="relative">
                  <input
                    className={`${inputClass} pr-6 text-right`}
                    inputMode="decimal"
                    value={r.percent}
                    onChange={(e) => update(i, { percent: e.target.value.replace(/[^\d.]/g, "") })}
                    aria-label={`Heir ${i + 1} share`}
                  />
                  <span className="pointer-events-none absolute top-2 right-2 text-xs text-muted">%</span>
                </div>
                <button
                  onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                  disabled={rows.length === 1}
                  className="flex items-center justify-center rounded-control border border-border text-muted hover:text-text disabled:opacity-30"
                  aria-label="Remove heir"
                >
                  <Trash2 size={14} strokeWidth={1.5} />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between">
            <button
              onClick={() => setRows((rs) => [...rs, { account: "", percent: "" }])}
              disabled={rows.length >= 8}
              className="inline-flex items-center gap-1 text-xs text-muted hover:text-text disabled:opacity-30"
            >
              <Plus size={14} strokeWidth={1.5} /> Add heir
            </button>
            <span className={`num text-xs ${Math.abs(total - 100) < 1e-9 ? "text-muted" : "text-warn"}`}>{total}% of 100%</span>
          </div>
          {!unique && <p className="mt-1 text-xs text-warn">Each heir can appear once.</p>}
        </div>

        <Field label="Owner" hint="The connected wallet owns the trust and is the only account that can spend, heartbeat or veto.">
          <div className="num text-[13px]">{accountId ?? "Connect a wallet first"}</div>
        </Field>

        <Button disabled={!accountId || !valid || (steps?.some((s) => s.status === "active") ?? false)} onClick={submit}>
          Create trust
        </Button>
        {steps && (
          <div className="border-t border-border pt-4">
            <Steps steps={steps} />
          </div>
        )}
      </div>
    </Card>
  );
}
