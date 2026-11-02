# Build log

Each time the rails or our code surprise us: the dead end, the path chosen and the test that guards it.

## 2026-11-02: research

- **Signer API is newer than the docs.** The docs show `sign` only through chainsig.js. The MPC source (`near/mpc` `crates/near-mpc-crypto-types/src/sign.rs`) shows the wire format is `{path, payload_v2: {Ecdsa|Eddsa}, domain_id}`, and the legacy `payload` and `key_version` fields are still accepted. Deposit is 1 yocto; gas requirement is 15 Tgas (testnet `config`). Testnet signer is v3.18.0.
- **Foreign-tx verification exists.** `verify_foreign_transaction` has the MPC network attest a tx on another chain. On testnet it covers Base/Solana/Arbitrum/Polygon/etc. but **not Bitcoin** (mainnet has Bitcoin). That's a candidate for the M4 "proof of life from your everyday wallet".
- **Intents has no testnet**, so the 1Click payout gets proven on mainnet with small amounts.
