export const CONTRACT_ID = process.env.NEXT_PUBLIC_KINFOLIO_CONTRACT ?? "app.kinfolio-musa.testnet";
// rpc.testnet.near.org is deprecated and returns 429s; providers: docs.near.org/api/rpc/providers
export const NEAR_RPC = process.env.NEXT_PUBLIC_NEAR_RPC ?? "https://test.rpc.fastnear.com";
export const NEAR_RPC_FALLBACK = "https://near-testnet.drpc.org";
export const MEMPOOL_API = process.env.NEXT_PUBLIC_BTC_MEMPOOL_API ?? "https://mempool.space/testnet4/api";
export const MEMPOOL_FALLBACK_API = "https://blockstream.info/testnet4/api";
export const MEMPOOL_WEB = MEMPOOL_API.replace(/\/api$/, "");
export const BASE_RPC = process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC ?? "https://sepolia.base.org";
export const NEAR_EXPLORER = "https://explorer.testnet.near.org";
export const BASESCAN = "https://sepolia.basescan.org";
export const DEMO_TRUST_ID = Number(process.env.NEXT_PUBLIC_DEMO_TRUST_ID ?? 0);
/** Trust 6: created, lapsed, claimed, released and paid on both chains by `pnpm e2e` (13 Nov 2026); the run in the demo video. */
export const RELEASED_TRUST_ID = Number(process.env.NEXT_PUBLIC_RELEASED_TRUST_ID ?? 6);
export const TGAS = (n: number) => String(n * 1_000_000_000_000);
