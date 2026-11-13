# Submission

- **Project name:** Kinfolio on NEAR
- **Tracks:** open, realworld
- **Team size:** 1
- **Repository:** https://github.com/techbone/kinfolio-near
- **Live app:** https://kinfolio-near.vercel.app
- **Demo post:** _TODO (X post link)_
- **NEAR wallet (mainnet payout):** _TODO_

## What did you build? (20–2,000 chars)

Kinfolio is a family trust for self-custodied crypto: a will for your Bitcoin and ETH, carried out by a NEAR contract.

A NEAR contract holds native BTC (Bitcoin testnet4) and ETH (Base Sepolia) at addresses derived for it by NEAR's MPC network through Chain Signatures. While the owner is active, nothing moves. If the owner goes quiet for longer than they chose, an heir can start a claim, and the owner can still veto it during a challenge window. Once the window passes, the contract itself builds the payout transactions and the MPC network signs them, paying each heir their share on both chains.

The hard part is that whoever builds a transaction picks the recipient. So the contract never signs a hash someone hands it. It builds the transactions itself:
- **Bitcoin:** BIP-143 P2WPKH, with outputs taken from its own heir list.
- **EVM:** EIP-1559, calling a splitter contract that divides the value 60/40 on-chain.

Callers can only supply inputs and a capped fee. That's why the "Pay heirs" button is public: whoever presses it pays NEAR gas and can't change who gets paid.

Proof: a headless e2e (`pnpm e2e`) runs the whole flow against the real rails. It creates a trust, funds it with an MPC-signed BTC spend and real ETH, lets the owner lapse, then claims, releases and pays both heirs on both chains in about 2.5 minutes. The run in the demo video is trust 6, paid on Bitcoin (tx e3bc1618…) and on Base (tx 0xc2e2b258…). There are 28 contract tests, including a byte-for-byte match of our EVM serialization against Foundry, and 6 splitter tests including a fuzz.

The README has a 60-second verify section and an honesty table. Gasless heirs, NEAR Intents payouts and foreign-chain proof of life were cut for time.
