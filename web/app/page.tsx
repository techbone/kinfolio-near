import Link from "next/link";
import { CreateTrust } from "@/components/create-trust";
import { MyTrusts } from "@/components/my-trusts";
import { DEMO_TRUST_ID, RELEASED_TRUST_ID } from "@/lib/config";

const HOW = [
  ["Create", "Name your heirs and their shares. The NEAR MPC network derives Bitcoin and EVM addresses that only this contract can sign for."],
  ["Live", "Spend from the trust as usual. Every signature the contract requests for you resets the inactivity clock."],
  ["Claim", "After the inactivity period an heir can start a claim. You can veto it until the challenge window closes."],
  ["Release", "With no veto, the contract builds the payout transactions itself and signs them. No company ever holds a key."],
];

export default function Home() {
  return (
    <div className="space-y-10">
      <section className="grid gap-8 md:grid-cols-[1.1fr_1fr] md:items-end">
        <div>
          <h1 className="font-display text-4xl leading-[1.05] tracking-tight sm:text-5xl">
            Your keys outlive you.
            <br />
            <span className="text-muted">No company ever holds them.</span>
          </h1>
          <p className="mt-4 max-w-prose text-[15px] text-muted">
            Kinfolio is a family trust for self-custodied Bitcoin and ETH. A NEAR contract controls native addresses through Chain Signatures, waits out a period of
            inactivity you choose, and then pays your heirs in the shares you set.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 md:justify-end md:pb-1">
          <Link
            href={`/trust/${RELEASED_TRUST_ID}`}
            className="inline-flex h-9 items-center rounded-control border border-border px-4 text-sm font-medium hover:bg-surface"
          >
            See a trust that paid out
          </Link>
          <Link
            href={`/trust/${DEMO_TRUST_ID}`}
            className="inline-flex h-9 items-center rounded-control bg-accent px-4 text-sm font-medium text-accent-fg hover:opacity-90"
          >
            Open the live demo trust
          </Link>
        </div>
      </section>

      <ol className="grid gap-px overflow-hidden rounded-card border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
        {HOW.map(([title, body], i) => (
          <li key={title} className="bg-surface p-4">
            <div className="num text-xs text-muted">0{i + 1}</div>
            <div className="mt-2 font-display text-lg tracking-tight">{title}</div>
            <p className="mt-1 text-[13px] text-muted">{body}</p>
          </li>
        ))}
      </ol>

      <MyTrusts />
      <CreateTrust />
    </div>
  );
}
