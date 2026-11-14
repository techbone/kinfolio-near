# Submission

- **Project name:** Kinfolio on NEAR
- **Tracks:** open, realworld
- **Team size:** 1
- **Repository:** https://github.com/techbone/kinfolio-near
- **Live app:** https://kinfolio-near.vercel.app
- **Demo post:** https://x.com/etudayesol/status/2121713613245145214
- **Demo video:** https://github.com/techbone/kinfolio-near/blob/main/docs/kinfolio-demo.mp4

## What did you build? (20–2,000 chars)

The problem: people who hold their own Bitcoin and ETH have no good way to pass it on. A seed phrase in a drawer hands everything to whoever finds it. Collaborative custody means a company holds one of your keys. Most people do nothing. Chainalysis estimates about 20% of mined BTC is lost or stranded, and QuadrigaCX lost about C$190M when its only keyholder died.

What I built: Kinfolio, a family trust for self-custodied crypto. It's a will for your Bitcoin and ETH, carried out by a NEAR contract. While the owner is active, nothing moves. If the owner goes quiet for longer than they chose, an heir can start a claim, and the owner can still veto it during a challenge window. Once the window passes, the contract pays each heir their share on both chains.

How NEAR fits: through Chain Signatures, the contract holds native BTC (Bitcoin testnet4) and ETH (Base Sepolia) at addresses NEAR's MPC network derives for it. Nothing is wrapped or bridged, and no company holds a key. Whoever builds a transaction picks the recipient, so the contract never signs a hash someone hands it. It builds the transactions itself: BIP-143 for Bitcoin, with one output per heir, and EIP-1559 calling a splitter that divides ETH 60/40 on-chain. Callers only supply inputs and a capped fee, so "Pay heirs" is a public button that can't redirect funds.

Proof: `pnpm e2e` runs the whole flow on the real rails in about 2.5 minutes: create, fund with an MPC-signed spend, lapse, claim, release, and pay both heirs on both chains. The run in the demo is trust 6, paid on Bitcoin (tx e3bc1618…) and on Base (tx 0xc2e2b258…). There are 28 contract tests and 6 splitter tests. The README has a 60-second verify section and an honesty table; gasless heirs and NEAR Intents payouts were cut for time.
