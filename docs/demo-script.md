# Demo script (1 min 48 s)

Everything in the live section is a real recording of `kinfolio-near.vercel.app/trust/6`, captured while `pnpm e2e` ran against NEAR testnet, Bitcoin testnet4 and Base Sepolia (log: `docs/evidence/e2e-2026-11-13-00-02.txt`). Sped-up parts carry an on-screen speed label. The score is synthesized, with no samples and no voiceover.

| Time | Screen | On-screen text | Must be true |
|---|---|---|---|
| 0:00 | Heartbeat monitor, then a flatline | "Your keys outlive you." | |
| 0:10 | Title; the state timeline draws Active → Challenge → Released | "A will for your Bitcoin and ETH, carried out by a NEAR contract." | |
| 0:14 | The promise | No company holds a key; nothing is wrapped or bridged | |
| 0:19 | How it works: contract, MPC network, Bitcoin, Base, owner, heirs | Derivation, who can sign, the dead-man switch | Addresses shown are trust 6's |
| 0:29 | Live trust page with the e2e terminal and an owner monitor, 8 chapters | Create → quiet → fund → claim → no veto → MPC signs → both heirs paid → emptied | Trust 6 run; CHALLENGE and RELEASED stamps land on the real state changes |
| 1:28 | Split proof: Blockstream testnet4 `e3bc1618…d827cb` and Blockscout `0xc2e2b258…a5bcfd` | 5,195 / 3,464 sats and 0.00119902 / 0.00079935 ETH (60/40) | Amounts match the explorers |
| 1:35 | What's under it | BIP-143 and EIP-1559 built in the contract, payouts can't be redirected, 28 + 6 tests | Counts match the README |
| 1:41 | End card | Live link, repo, NEAR HACKATHON 2026 | |

How it was made: the browser footage is timestamped screenshots of the live page; titles, captions and camera moves come from an HTML compositor stepped frame by frame in headless Chrome; ffmpeg synthesizes the score and encodes.
