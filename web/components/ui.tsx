"use client";

import { useState, type ReactNode } from "react";
import { Check, Copy, ExternalLink, Loader2, X } from "lucide-react";
import { shortHash } from "@/lib/format";

export function Card({ title, aside, children }: { title?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-card border border-border bg-surface">
      {title && (
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-medium">{title}</h2>
          {aside}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Mono({ value, href, short = true }: { value: string; href?: string; short?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <span className="num inline-flex items-center gap-1.5 text-[13px]">
      <span title={value}>{short ? shortHash(value, 8) : value}</span>
      <button onClick={copy} aria-label="Copy" className="text-muted hover:text-text">
        {copied ? <Check size={14} strokeWidth={1.5} /> : <Copy size={14} strokeWidth={1.5} />}
      </button>
      {href && (
        <a href={href} target="_blank" rel="noreferrer" aria-label="Open in explorer" className="text-muted hover:text-text">
          <ExternalLink size={14} strokeWidth={1.5} />
        </a>
      )}
    </span>
  );
}

export type StepStatus = "idle" | "active" | "done" | "error";
export interface Step {
  label: string;
  status: StepStatus;
  detail?: ReactNode;
}

/** Named steps instead of one spinner: each says what it's waiting on. */
export function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol className="space-y-2">
      {steps.map((s, i) => (
        <li key={i} className="flex items-start gap-3">
          <span
            className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] ${
              s.status === "done"
                ? "border-accent bg-accent text-accent-fg"
                : s.status === "error"
                  ? "border-danger text-danger"
                  : s.status === "active"
                    ? "border-accent text-accent"
                    : "border-border text-muted"
            }`}
          >
            {s.status === "done" ? (
              <Check size={12} strokeWidth={2} />
            ) : s.status === "error" ? (
              <X size={12} strokeWidth={2} />
            ) : s.status === "active" ? (
              <Loader2 size={12} strokeWidth={2} className="animate-spin" />
            ) : (
              i + 1
            )}
          </span>
          <div className="min-w-0">
            <div className={s.status === "idle" ? "text-muted" : ""}>{s.label}</div>
            {s.detail && <div className="mt-0.5 text-xs text-muted">{s.detail}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function Button({
  children,
  variant = "primary",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const styles = {
    primary: "bg-accent text-accent-fg hover:opacity-90",
    secondary: "border border-border hover:bg-bg",
    danger: "border border-danger text-danger hover:bg-bg",
  }[variant];
  return (
    <button
      {...props}
      className={`inline-flex h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-control px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 ${styles} ${props.className ?? ""}`}
    >
      {children}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "num h-9 w-full rounded-control border border-border bg-bg px-3 text-[13px] placeholder:text-muted/60";
