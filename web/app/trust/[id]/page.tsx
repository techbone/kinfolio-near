import { Suspense } from "react";
import { notFound } from "next/navigation";
import { TrustView } from "@/components/trust-view";

export default function TrustPage({ params }: PageProps<"/trust/[id]">) {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-card border border-border bg-surface" />}>
      <TrustRoute params={params} />
    </Suspense>
  );
}

async function TrustRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  return <TrustView id={Number(id)} />;
}
