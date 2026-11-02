# Build log

Each time the rails or our code surprise us: the dead end, the path chosen and the test that guards it.

## 2026-11-02: research

- **Signer API is newer than the docs.** The docs show `sign` only through chainsig.js. The MPC source (`near/mpc` `crates/near-mpc-crypto-types/src/sign.rs`) shows the wire format is `{path, payload_v2: {Ecdsa|Eddsa}, domain_id}`, and the legacy `payload` and `key_version` fields are still accepted. Deposit is 1 yocto; gas requirement is 15 Tgas (testnet `config`). Testnet signer is v3.18.0.
- **Foreign-tx verification exists.** `verify_foreign_transaction` has the MPC network attest a tx on another chain. On testnet it covers Base/Solana/Arbitrum/Polygon/etc. but **not Bitcoin** (mainnet has Bitcoin). That's a candidate for the M4 "proof of life from your everyday wallet".
- **Intents has no testnet**, so the 1Click payout gets proven on mainnet with small amounts.

## 2026-11-02: M1 contract on real rails

- **Hand-rolled BIP-143 instead of omni-transaction for BTC.** omni's `p2wpkh_script_code` helper takes a script-ish argument whose contract is unclear, and the sighash is the one place a mistake silently loses funds. The BIP-143 sighash is ~60 lines; `sighash_matches_rust_bitcoin` checks it (and the txid) against rust-bitcoin for 1–3 inputs. omni stays for EVM in M2.
- **Key derivation by asking the signer, not by doing EC math in the contract.** `create_trust` calls the signer's `derived_public_key` view (predecessor = our contract, path `trust-{id}`) and stores the result in a callback. No k256 in the wasm (245 KB total). If the call fails the trust is unwound, so a trust never exists without a key.
- **The signer's `sign` takes `payload_v2: {"Ecdsa": hex}`**, not the legacy `payload`. Docs only show it through chainsig.js; the shape came from `near/mpc` source and was confirmed by a real call. Response is `{scheme:"Secp256k1", big_r:{affine_point}, s:{scalar}, recovery_id}`; BTC needs only r = x(big_r) and s.
- **Low-S.** Bitcoin relay policy rejects high-S. The contract normalizes `s` to `N - s` when `s > N/2` (`der_encoding_is_canonical`).
- **Proof without coins:** `examples/verify_signed.rs` re-derives the sighash with rust-bitcoin and verifies the MPC signature against the witness key, and that the key hashes to the trust's address. Output in `docs/evidence/m1-sign-verify.txt`. A broadcast on testnet4 is still to do once the address is funded.

## 2026-11-02: M1 web app

- **Next.js here is 16.4 with Cache Components on by default.** Dynamic routes must read `params` under a `<Suspense>`; reading the clock during prerender is an error. The trust page is a server shell (`await params` inside Suspense) around a client component, and countdowns use `useSyncExternalStore` with a `null` server snapshot (`lib/use-now.ts`) instead of `setState` in an effect.
- **Reads go straight to NEAR RPC (`call_function`), no wallet needed**, so the demo trust is judgeable without connecting anything. The wallet is only for actions, via `@hot-labs/near-connect` (`signAndSendTransaction` with `FunctionCall` actions).
- **Don't trust a cross-origin iframe for responsive screenshots.** A file:// page framing localhost blocks storage, so the app never hydrates and looks stuck on its skeleton. Same-origin framing showed the real 390px layout. A stale `next start` also survived `pkill -f`; kill by port.
- **Spend flow ends on the source of truth.** Named steps: pick UTXOs and fee, contract builds and MPC signs (polls `get_last_signed` until `signed_at_secs` advances), broadcast, seen on mempool.space. Dust change is folded into the fee client-side because the contract rejects it.
