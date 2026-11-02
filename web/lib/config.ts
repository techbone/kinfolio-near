export const CONTRACT_ID = process.env.NEXT_PUBLIC_KINFOLIO_CONTRACT ?? "app.kinfolio-musa.testnet";
export const NEAR_RPC = process.env.NEXT_PUBLIC_NEAR_RPC ?? "https://rpc.testnet.near.org";
export const MEMPOOL_API = process.env.NEXT_PUBLIC_BTC_MEMPOOL_API ?? "https://mempool.space/testnet4/api";
export const MEMPOOL_WEB = MEMPOOL_API.replace(/\/api$/, "");
export const BASE_RPC = process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC ?? "https://sepolia.base.org";
export const NEAR_EXPLORER = "https://explorer.testnet.near.org";
export const BASESCAN = "https://sepolia.basescan.org";
export const DEMO_TRUST_ID = Number(process.env.NEXT_PUBLIC_DEMO_TRUST_ID ?? 0);
export const TGAS = (n: number) => String(n * 1_000_000_000_000);
