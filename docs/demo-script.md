# Demo script (about 2 min 10 s)

Everything in the live section is a real recording of `kinfolio-near.vercel.app/trust/6` captured while `pnpm e2e` ran against NEAR testnet, Bitcoin testnet4 and Base Sepolia (log: `docs/evidence/e2e-2026-11-13-00-02.txt`). Sped-up parts carry an on-screen speed label. The score is synthesized (no samples).

| Time | Screen | On-screen text | Must be true |
|---|---|---|---|
| 0:00 | Cold open | "Your keys outlive you. And no company ever holds them." | |
| 0:07 | Title, state timeline draws Active → Challenge → Released | "A will for your Bitcoin and ETH, carried out by a NEAR contract." | |
| 0:14 | Diagram: contract, MPC network, Bitcoin, Base, owner, heirs | Three captions on derivation, who can sign, and the dead-man switch | Addresses shown are trust 6's |
| 0:31 | "This is a real run." | NEAR testnet · Bitcoin testnet4 · Base Sepolia · nothing mocked | |
| 0:34 | Live trust page + e2e terminal, 7 chapters | Create → fund → claim → released → MPC signs → both heirs paid → emptied | Trust 6 run |
| 1:35 | Blockstream testnet4 tx `e3bc1618…d827cb` | One input, one output per heir (5,195 / 3,464 sats) | |
| 1:42 | Blockscout internal txns for `0xc2e2b258…a5bcfd` | Splitter pays 60/40 (0.00119902 / 0.00079935 ETH) | |
| 1:49 | What's under it | BIP-143/EIP-1559 in the contract, payouts can't be redirected, test counts | Counts match the README |
| 1:59 | End card | Live link, repo, NEAR HACKATHON 2026 | |

Optional insert (owner's own wallet): connect Meteor (testnet), create a trust with demo timers, press "I'm here (heartbeat)", then as heir press "Pay heirs in ETH" on trust 3.

How it was made: the browser footage is timestamped screenshots of the live page; titles, captions and camera moves come from an HTML compositor stepped frame by frame in headless Chrome; ffmpeg encodes.
