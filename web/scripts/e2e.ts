/**
 * Headless end-to-end run against the real rails (NEAR testnet + MPC signer, Bitcoin testnet4,
 * Base Sepolia). Same helpers as the web app. Writes a log to docs/evidence/.
 *
 *   create trust -> fund (BTC from the demo trust, ETH from the deployer) -> owner goes quiet
 *   -> heir starts claim -> challenge window passes -> finalize -> contract signs payouts
 *   -> broadcast -> both heirs paid
 *
 * Keys: owner and heirs from ~/.near-credentials/testnet, payout addresses and the EVM deployer
 * key from the repo's .env. Nothing is mocked; a step that can't run says so and the run fails.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Account } from "near-api-js";
import { BASE_RPC, BASESCAN, CONTRACT_ID, MEMPOOL_WEB, NEAR_EXPLORER, NEAR_RPC } from "../lib/config";
import { getTrust, view } from "../lib/near";
import { broadcast, feeRate, fetchTx, fetchUtxos, selectUtxos, vsize } from "../lib/btc";
import * as evm from "../lib/evm";
import type { SignedTx } from "../lib/types";

const ROOT = path.resolve(__dirname, "../..");
const env: Record<string, string> = { ...loadEnv(path.join(ROOT, ".env")), ...(process.env as Record<string, string>) };

const OWNER = "kinfolio-musa.testnet";
const HEIR_A = "heir-a.kinfolio-musa.testnet";
const HEIR_B = "heir-b.kinfolio-musa.testnet";
const FUND_FROM_TRUST = Number(env.E2E_FUND_FROM_TRUST ?? 0);
const FUND_SATS = Number(env.E2E_FUND_SATS ?? 12_000);
const FUND_WEI = BigInt(env.E2E_FUND_WEI ?? "2000000000000000"); // 0.002 ETH
const INACTIVITY_SECS = 20;
const CHALLENGE_SECS = 15;
const GAS_300 = 300_000_000_000_000n;
const GAS_100 = 100_000_000_000_000n;

const log: string[] = [];
function step(title: string, ...lines: string[]) {
  const block = [`\n== ${title}`, ...lines.map((l) => `   ${l}`)].join("\n");
  console.log(block);
  log.push(block);
}

const account = (id: string) => new Account(id, NEAR_RPC, nearKey(id));
const owner = account(OWNER);
const heirA = account(HEIR_A);
const heirB = account(HEIR_B);

async function call<T>(who: Account, methodName: string, args: Record<string, unknown>, gas = GAS_100): Promise<T> {
  return (await who.callFunction({ contractId: CONTRACT_ID, methodName, args, gas })) as T;
}

async function main() {
  const started = new Date();
  step("Setup", `contract ${CONTRACT_ID}`, `owner ${OWNER}`, `heirs ${HEIR_A} (60%), ${HEIR_B} (40%)`, `started ${started.toISOString()}`);

  // 1. Create the trust. The MPC signer derives its key in the callback.
  const id = Number(await view<string>("next_trust_id"));
  await call(owner, "create_trust", {
    inactivity_secs: INACTIVITY_SECS,
    challenge_secs: CHALLENGE_SECS,
    heirs: [
      { account: HEIR_A, bps: 6000, btc_address: must("E2E_HEIR_A_BTC"), evm_address: must("E2E_HEIR_A_EVM") },
      { account: HEIR_B, bps: 4000, btc_address: must("E2E_HEIR_B_BTC"), evm_address: must("E2E_HEIR_B_EVM") },
    ],
  });
  const trust = await waitFor(`trust ${id} derived`, async () => {
    const t = await getTrust(id);
    return t?.owner === OWNER && t.btc_address ? t : null;
  });
  step("1. create_trust", `trust ${id}`, `BTC ${trust.btc_address}`, `EVM ${trust.evm_address}`, `inactivity ${INACTIVITY_SECS}s, challenge ${CHALLENGE_SECS}s`);

  // 2. Fund BTC: the owner spends from the demo trust into the new one (a real MPC-signed spend).
  const source = (await getTrust(FUND_FROM_TRUST))!;
  const rate = await feeRate();
  const fundFee = vsize(1, 2) * rate + 200;
  const picked = selectUtxos(await fetchUtxos(source.btc_address!), FUND_SATS + fundFee + 600);
  if (!picked) throw new Error(`trust ${FUND_FROM_TRUST} can't cover ${FUND_SATS} sats; fund ${source.btc_address}`);
  const funding = await call<SignedTx>(
    owner,
    "owner_sign_btc",
    { id: FUND_FROM_TRUST, utxos: picked.map(({ txid, vout, value }) => ({ txid, vout, value })), to: trust.btc_address, amount_sats: FUND_SATS, fee_sats: fundFee },
    GAS_300,
  );
  await broadcast(funding.raw_hex);
  step("2. fund BTC", `owner_sign_btc on trust ${FUND_FROM_TRUST} -> ${FUND_SATS} sats`, `${MEMPOOL_WEB}/tx/${funding.txid}`);

  // 3. Fund ETH from the deployer, if a splitter and a deployer key are configured.
  const splitter = await view<string | null>("get_splitter");
  const evmReady = Boolean(splitter && env.DEPLOYER_EVM_PRIVATE_KEY);
  if (evmReady) {
    const out = cast(["send", "--json", "--private-key", env.DEPLOYER_EVM_PRIVATE_KEY, "--rpc-url", BASE_RPC, "--value", FUND_WEI.toString(), trust.evm_address!]);
    step("3. fund ETH", `${FUND_WEI} wei from deployer`, `${BASESCAN}/tx/${JSON.parse(out).transactionHash}`);
  } else {
    step("3. fund ETH", "SKIPPED: splitter not set or no deployer key; EVM payout will not run");
  }

  // 4. The owner goes quiet. Wait out the inactivity period on chain time.
  await sleepUntil(trust.claimable_after_secs + 2);
  await call(heirA, "start_claim", { id });
  const challenged = (await getTrust(id))!;
  step("4. start_claim", `${HEIR_A} started a claim`, `state ${challenged.state}, finalizable after ${new Date(challenged.finalizable_after_secs! * 1000).toISOString()}`);

  // 5. No veto. Anyone can finalize once the window passes.
  await sleepUntil(challenged.finalizable_after_secs! + 2);
  await call(heirB, "finalize", { id });
  step("5. finalize", `state ${(await getTrust(id))!.state}`);

  // 6. BTC payout: the contract builds the outputs from its own heir list.
  const utxos = await waitFor("funding output visible", async () => {
    const u = await fetchUtxos(trust.btc_address!);
    return u.length ? u : null;
  });
  const payFee = vsize(utxos.length, 2) * rate + 200;
  const payout = await call<SignedTx>(heirB, "distribute_btc", { id, utxos: utxos.map(({ txid, vout, value }) => ({ txid, vout, value })), fee_sats: payFee }, GAS_300);
  await broadcast(payout.raw_hex);
  const paid = await waitFor("payout in mempool", () => fetchTx(payout.txid));
  const btcLines = paid.vout.map((o) => `${o.scriptpubkey_address === env.E2E_HEIR_A_BTC ? HEIR_A : o.scriptpubkey_address === env.E2E_HEIR_B_BTC ? HEIR_B : "UNKNOWN"} <- ${o.value} sats (${o.scriptpubkey_address})`);
  if (btcLines.some((l) => l.startsWith("UNKNOWN"))) throw new Error("payout went to an address that is not an heir");
  step("6. distribute_btc", `inputs ${utxos.reduce((s, u) => s + u.value, 0)} sats, fee ${payFee}`, ...btcLines, `${MEMPOOL_WEB}/tx/${payout.txid}`);

  // 7. ETH payout through KinfolioSplitter.
  if (evmReady) {
    const evmAddr = trust.evm_address!;
    await waitFor("ETH arrived", async () => ((await evm.balanceWei(evmAddr)) > 0n ? true : null));
    const params = await evm.payoutParams(evmAddr);
    if (!params) throw new Error("trust ETH balance does not cover gas");
    const before = [await evm.balanceWei(must("E2E_HEIR_A_EVM")), await evm.balanceWei(must("E2E_HEIR_B_EVM"))];
    const signed = await call<SignedTx>(heirA, "distribute_evm", { id, ...params }, GAS_100);
    const hash = await evm.sendRaw(signed.raw_hex);
    const rcpt = await waitFor("EVM receipt", () => evm.receipt(hash));
    if (rcpt.status !== "0x1") throw new Error(`EVM payout reverted: ${hash}`);
    const after = [await evm.balanceWei(must("E2E_HEIR_A_EVM")), await evm.balanceWei(must("E2E_HEIR_B_EVM"))];
    const value = params.value_wei;
    step(
      "7. distribute_evm",
      `value ${value} wei through splitter ${splitter}`,
      `${HEIR_A} <- ${after[0] - before[0]} wei`,
      `${HEIR_B} <- ${after[1] - before[1]} wei`,
      `${BASESCAN}/tx/${hash}`,
    );
  } else {
    step("7. distribute_evm", "SKIPPED (see step 3)");
  }

  step("Done", `trust ${id} released and paid out`, `NEAR account: ${NEAR_EXPLORER}/accounts/${CONTRACT_ID}`, `took ${Math.round((Date.now() - started.getTime()) / 1000)}s`);
  const file = path.join(ROOT, "docs/evidence", `e2e-${started.toISOString().slice(0, 16).replace(/[:T]/g, "-")}.txt`);
  fs.writeFileSync(file, log.join("\n").trimStart() + "\n");
  console.log(`\nlog saved to ${path.relative(ROOT, file)}`);
  if (!evmReady) process.exitCode = 2;
}

// ------------------------------------------------------------------ helpers

function loadEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=([^#\s]*)/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function must(name: string): string {
  const v = env[name];
  if (!v) throw new Error(`${name} missing from .env`);
  return v;
}

function nearKey(id: string): `ed25519:${string}` {
  const file = path.join(os.homedir(), ".near-credentials/testnet", `${id}.json`);
  return JSON.parse(fs.readFileSync(file, "utf8")).private_key;
}

function cast(args: string[]): string {
  return execFileSync(path.join(os.homedir(), ".foundry/bin/cast"), args, { encoding: "utf8" });
}


async function waitFor<T>(what: string, check: () => Promise<T | null>, timeoutSecs = 180): Promise<T> {
  const until = Date.now() + timeoutSecs * 1000;
  while (Date.now() < until) {
    const v = await check().catch(() => null);
    if (v) return v;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Sleeps until NEAR block time passes `secs`. */
async function sleepUntil(secs: number) {
  for (;;) {
    const block = await fetch(NEAR_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "block", params: { finality: "final" } }),
    }).then((r) => r.json());
    const now = Number(BigInt(block.result.header.timestamp_nanosec) / 1_000_000_000n);
    if (now >= secs) return;
    process.stdout.write(`   waiting ${secs - now}s of chain time\r`);
    await new Promise((r) => setTimeout(r, Math.min(5, secs - now) * 1000));
  }
}

main().catch((e) => {
  console.error(`\nE2E FAILED: ${e instanceof Error ? e.message : e}`);
  log.push(`\nFAILED: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});

