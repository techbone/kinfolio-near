# AGENTS.md

Read `ARCHITECTURE.md` first. It holds the flows, the capability map and the milestones.

## Rules

- Testnet first. Keys live in `.env` and are never committed. Mainnet only for the NEAR Intents (1Click) payout proof.
- Never guess contract IDs, endpoints or SDK versions. Look them up in docs.near.org/llms.txt, docs.near-intents.org/llms.txt, or the source.
- Commits: one-line lowercase conventional commits (`feat: add owner_sign`), no body, no co-author or "generated" lines.
- Every sponsor-rail surprise goes in `docs/build-log.md`: the dead end, the path chosen, and the test that guards it.
- The UI never says "done" until the source of truth confirms it (NEAR tx outcome, mempool/explorer status, 1Click status).

## Stack gotchas

- MPC signer: `v1.signer-prod.testnet` (testnet), `v1.signer` (mainnet). `sign({request:{path, payload_v2:{Ecdsa:"<32-byte hex>"}, domain_id:0}})`, attach **1 yoctoNEAR** and **≥15 Tgas** for the signer. It resolves via yield/resume, so contract callers need a callback.
- Derived address = f(MPC root key, **predecessor account**, path). Signing from our contract means addresses derive from the contract account, not the user.
- BTC: one `sign` call per input. The BIP-143 sighash commits to input amounts, so wrong caller-supplied values give invalid sigs, not theft.
- Foreign-tx verification on testnet: Base/Solana/Arbitrum/Polygon/…, **not Bitcoin** (mainnet only). EVM extractors only return `BlockHash` or a `Log{log_index}`.
- NEAR Intents has **no testnet**.
- Accounts holding only function-call keys can't transfer NEAR or add keys.

## Design rules (web)

The feel is calm and archival: a document you'd trust with an estate. Reference: Linear, Stripe, Mercury.

- **Type:** display `Newsreader` (serif, tight tracking on large sizes); body `Inter`; mono `JetBrains Mono` for addresses, hashes, amounts and timers. Tabular figures for every number.
- **Scale:** 12 / 14 / 16 / 20 / 28 / 40 / 56. Spacing on a 4px grid: 4, 8, 12, 16, 24, 32, 48, 64.
- **Color tokens** (CSS variables, light/dark designed separately):
  - `--bg` #FBFAF7 / #0E0F0E · `--surface` #FFFFFF / #161816 · `--border` #E7E4DC / #262926
  - `--text` #1B1C1A / #ECEDE9 · `--muted` #6B6C66 / #8E918A
  - `--accent` #1F5E46 / #5FB38D (forest; used sparingly: primary action, active state)
  - `--warn` #A15C07 / #E0A13A (challenge window) · `--danger` #9B2C2C / #E07070
- **Radii:** 6px controls, 10px cards. **Shadows:** none, or `0 1px 0 var(--border)`. Borders over shadows.
- **Icons:** Lucide at 16px, stroke 1.5, muted color.
- **Components:** the state timeline (Active → Challenge → Released) is the hero element. Tables for heirs and distributions. Every tx shows a short mono hash with a copy button and an explorer link. Named steps (Build → Sign (MPC) → Broadcast → Confirmed), never a single spinner.
- **Never:** gradients, glassmorphism, glow, emoji icons, sparkles, "AI-powered", the centered hero with three feature cards, filler copy ("seamless", "unlock", "revolutionize").
- **States:** design empty, loading and error states for every data view.
