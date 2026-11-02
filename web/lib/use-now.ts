"use client";

import { useSyncExternalStore } from "react";

function subscribe(onTick: () => void) {
  const t = setInterval(onTick, 1000);
  return () => clearInterval(t);
}

/** Unix seconds, ticking each second. `null` on the server: reading the clock during prerender is not allowed. */
export function useNow(): number | null {
  return useSyncExternalStore(
    subscribe,
    () => Math.floor(Date.now() / 1000),
    () => null,
  );
}
