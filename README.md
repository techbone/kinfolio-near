# Kinfolio on NEAR

<!-- badges: tests-N passing · rails-NEAR testnet + Chain Signatures · live-kinfolio-near.vercel.app -->

### Your keys outlive you, and no company ever holds them.

Kinfolio is a family trust for self-custodied crypto. A NEAR contract holds native BTC and ETH through Chain Signatures. If the owner stops spending, heirs can start a claim, and the owner can veto it. After the challenge window, the contract itself signs the payouts.

**Watch the demo** · [Live app](https://kinfolio-near.vercel.app) · [Verify it yourself](#verify-it-yourself-in-60-seconds) · [Architecture](ARCHITECTURE.md) · [Run it locally](#run-it-locally)

## Demo

_TODO: embedded video, length, and what it shows._

## Verify it yourself in 60 seconds

_TODO: contract view calls with expected output, explorer links, `npm test` summary, `npm run e2e`._

## Contents

- [The problem](#the-problem)
- [What it does](#what-it-does)
- [Architecture](#architecture)
- [The hard problem](#the-hard-problem)
- [What's real vs simplified](#whats-real-vs-simplified)
- [Engineering decisions](#engineering-decisions)
- [Project layout](#project-layout)
- [Run it locally](#run-it-locally)
- [Limitations and disclosure](#limitations-and-disclosure)

## The problem

_TODO: from ARCHITECTURE.md, with cited sources._

## What it does

| Capability | What the user does | NEAR calls behind it |
|---|---|---|
| _TODO_ | | |

## Architecture

_TODO: system flowchart, release sequence diagram, contract method table._

## The hard problem

_TODO: "Whoever builds the transaction picks the recipient." See ARCHITECTURE.md._

## What's real vs simplified

| Capability | How it's backed | Status |
|---|---|---|
| _TODO_ | | |

## Engineering decisions

_TODO_

## Project layout

```
contracts/kinfolio   # Rust NEAR contract: trusts, state machine, in-contract tx building
contracts/splitter   # Solidity: KinfolioSplitter on Base Sepolia
web/                 # Next.js app, relayer and keeper route handlers
scripts/             # headless e2e against testnet
docs/                # build log, evidence, demo script, submission text
```

## Run it locally

_TODO: prerequisites, env table (see `.env.example`), commands, tests._

## Limitations and disclosure

- Built for NEAR HACKATHON 2026 (tracks: Open Innovation, Real-World Money). Development started 2 Nov 2026.
- Kinfolio began as an EVM product by the same author. This repository is a new, NEAR-native implementation written during the hackathon window. No EVM Kinfolio code is reused except design ideas (the inactivity → challenge → release state machine).
- Libraries: _TODO list (near-sdk, omni-transaction-rs, chainsig.js, …)_. AI coding assistants were used.
- Testnet software. Not financial or legal advice.
