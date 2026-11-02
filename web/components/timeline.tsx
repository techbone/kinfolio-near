"use client";

import { duration } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import type { Trust } from "@/lib/types";

const STAGES = [
  { key: "Active", title: "Active", body: "Owner is alive. Spending or a heartbeat resets the clock." },
  { key: "Challenge", title: "Challenge", body: "An heir started a claim. The owner can still veto." },
  { key: "Released", title: "Released", body: "No veto. The contract can sign payouts to heirs." },
] as const;

export function Timeline({ trust }: { trust: Trust }) {
  const now = useNow();
  const current = STAGES.findIndex((s) => s.key === trust.state);

  let countdown: { label: string; value: string; tone: "muted" | "warn" | "accent" } | null = null;
  if (now !== null) {
    if (trust.state === "Active") {
      const left = trust.claimable_after_secs - now;
      countdown =
        left > 0
          ? { label: "Heirs can start a claim in", value: duration(left), tone: "muted" }
          : { label: "Inactivity period over", value: "claimable now", tone: "warn" };
    } else if (trust.state === "Challenge" && trust.finalizable_after_secs) {
      const left = trust.finalizable_after_secs - now;
      countdown =
        left > 0
          ? { label: "Owner can veto for another", value: duration(left), tone: "warn" }
          : { label: "Challenge window over", value: "ready to finalize", tone: "accent" };
    } else if (trust.state === "Released") {
      countdown = { label: "Payouts", value: "unlocked", tone: "accent" };
    }
  }

  return (
    <div>
      <ol className="grid grid-cols-3 gap-0">
        {STAGES.map((s, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={s.key} className="relative pr-4">
              <div className="flex items-center">
                <span
                  className={`size-3 rounded-full border-2 ${
                    active ? "border-accent bg-accent" : done ? "border-accent bg-bg" : "border-border bg-bg"
                  }`}
                />
                {i < STAGES.length - 1 && <span className={`ml-2 h-px flex-1 ${done ? "bg-accent" : "bg-border"}`} />}
              </div>
              <div className={`mt-3 font-display text-lg tracking-tight ${active ? "" : "text-muted"}`}>{s.title}</div>
              <p className="mt-1 text-xs text-muted">{s.body}</p>
            </li>
          );
        })}
      </ol>
      <div className="mt-5 flex items-baseline gap-3 border-t border-border pt-4">
        <span className="text-xs text-muted">{countdown?.label ?? " "}</span>
        <span
          className={`num text-2xl tracking-tight ${
            countdown?.tone === "warn" ? "text-warn" : countdown?.tone === "accent" ? "text-accent" : ""
          }`}
        >
          {countdown?.value ?? " "}
        </span>
      </div>
    </div>
  );
}
