export type TrustState = "Active" | "Challenge" | "Released";

export interface Heir {
  account: string;
  bps: number;
  btc_address: string | null;
  evm_address: string | null;
}

export interface Trust {
  id: number;
  owner: string;
  state: TrustState;
  inactivity_secs: number;
  challenge_secs: number;
  last_heartbeat_secs: number;
  claim_started_secs: number | null;
  claimant: string | null;
  heirs: Heir[];
  btc_address: string | null;
  evm_address: string | null;
  claimable_after_secs: number;
  finalizable_after_secs: number | null;
}

export interface SignedTx {
  chain: string;
  raw_hex: string;
  txid: string;
  signed_at_secs: number;
}
