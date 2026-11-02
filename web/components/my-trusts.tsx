"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { trustsFor, trustsOf } from "@/lib/near";
import { pct } from "@/lib/format";
import type { Trust } from "@/lib/types";
import { Card } from "./ui";
import { useWallet } from "./wallet";

export function MyTrusts() {
  const { accountId } = useWallet();
  const [owned, setOwned] = useState<Trust[] | null>(null);
  const [inherited, setInherited] = useState<Trust[] | null>(null);

  useEffect(() => {
    if (!accountId) return;
    trustsOf(accountId).then(setOwned).catch(() => setOwned([]));
    trustsFor(accountId).then(setInherited).catch(() => setInherited([]));
  }, [accountId]);

  if (!accountId) return null;
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <List title="Trusts you own" trusts={owned} empty="You don't own a trust yet. Create one below." role={() => "Owner"} />
      <List
        title="Trusts that name you as an heir"
        trusts={inherited}
        empty="No trust names this account as an heir."
        role={(t) => pct(t.heirs.find((h) => h.account === accountId)?.bps ?? 0)}
      />
    </div>
  );
}

function List({ title, trusts, empty, role }: { title: string; trusts: Trust[] | null; empty: string; role: (t: Trust) => string }) {
  return (
    <Card title={title}>
      {trusts === null ? (
        <div className="h-10 animate-pulse rounded-control bg-bg" />
      ) : trusts.length === 0 ? (
        <p className="text-muted">{empty}</p>
      ) : (
        <ul className="-my-2">
          {trusts.map((t) => (
            <li key={t.id} className="border-b border-border last:border-0">
              <Link href={`/trust/${t.id}`} className="flex items-center justify-between py-2 hover:text-accent">
                <span>
                  <span className="num">#{t.id}</span> <span className="text-muted">· {t.state}</span>
                </span>
                <span className="flex items-center gap-2 text-xs text-muted">
                  {role(t)} <ArrowRight size={14} strokeWidth={1.5} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
