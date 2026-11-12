//! Kinfolio on NEAR: a family trust that holds native BTC and ETH through Chain Signatures.
//!
//! One contract, many trusts. Each trust gets one derived secp256k1 key from the MPC signer
//! (path `trust-{id}`, predecessor = this contract), from which its BTC and EVM addresses follow.
//! The contract never lets a caller choose what gets signed: it builds the transaction itself
//! from its own state and asks the signer to sign the hashes it computed.

pub mod btc;
pub mod evm;

use near_sdk::json_types::{U128, U64};
use near_sdk::serde::Deserialize;
use near_sdk::store::LookupMap;
use near_sdk::{
    env, near, require, AccountId, Gas, GasWeight, NearToken, PanicOnDefault, Promise, PromiseError,
    PublicKey,
};
use std::collections::HashSet;
use std::str::FromStr;

const NS_PER_SEC: u64 = 1_000_000_000;
const MIN_PERIOD_SECS: u32 = 10;
const MAX_HEIRS: usize = 8;
const MAX_INPUTS: usize = 3;
const MAX_FEE_SATS: u64 = 50_000;
const SIGN_GAS: Gas = Gas::from_tgas(50);
const CALLBACK_GAS: Gas = Gas::from_tgas(30);
const VIEW_GAS: Gas = Gas::from_tgas(10);
const ON_DERIVED_GAS: Gas = Gas::from_tgas(10);
/// The MPC signer wants exactly 1 yoctoNEAR with each `sign` call.
const SIGN_DEPOSIT: NearToken = NearToken::from_yoctonear(1);
/// Domain 0 is the secp256k1 (CaitSith) signing domain on the MPC signer.
const SECP256K1_DOMAIN: u64 = 0;
/// Base Sepolia.
const EVM_CHAIN_ID: u64 = 84_532;
const MAX_EVM_GAS_LIMIT: u64 = 300_000;
/// Caps gas_limit x max_fee_per_gas so a keeper can't burn the trust's ETH as fees (0.001 ETH).
const MAX_EVM_FEE_WEI: u128 = 1_000_000_000_000_000;
/// Raw storage keys outside the borsh state struct, so adding them needs no state migration.
const SPLITTER_KEY: &[u8] = b"cfg:splitter";
const LAST_EVM_PREFIX: &[u8] = b"evm:";

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum State {
    /// Owner is alive as far as the contract knows.
    Active,
    /// An heir started a claim; the owner can still veto until the window ends.
    Challenge,
    /// Window passed; heirs may be paid out.
    Released,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Heir {
    pub account: AccountId,
    /// Share in basis points; all heirs of a trust sum to 10_000.
    pub bps: u16,
    /// Where this heir's BTC share goes (native segwit P2WPKH). Settable by the heir.
    pub btc_address: Option<String>,
    /// Where this heir's EVM share goes (0x...). Settable by the heir.
    pub evm_address: Option<String>,
}

#[near(serializers = [json])]
pub struct HeirInput {
    pub account: AccountId,
    pub bps: u16,
    pub btc_address: Option<String>,
    pub evm_address: Option<String>,
}

#[near(serializers = [borsh])]
pub struct Trust {
    pub owner: AccountId,
    pub state: State,
    pub inactivity_secs: u32,
    pub challenge_secs: u32,
    pub last_heartbeat_ns: u64,
    pub claim_started_ns: Option<u64>,
    pub claimant: Option<AccountId>,
    pub heirs: Vec<Heir>,
    /// Uncompressed (x || y) derived key, set once the signer answers. `None` = still deriving.
    pub pubkey: Option<Vec<u8>>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct SignedTx {
    pub chain: String,
    pub raw_hex: String,
    pub txid: String,
    pub signed_at_secs: u64,
}

#[near(serializers = [json])]
pub struct Utxo {
    /// Transaction id as shown by block explorers (display order).
    pub txid: String,
    pub vout: u32,
    pub value: u64,
}

#[near(serializers = [json])]
pub struct TrustView {
    pub id: u64,
    pub owner: AccountId,
    pub state: State,
    pub inactivity_secs: u32,
    pub challenge_secs: u32,
    pub last_heartbeat_secs: u64,
    pub claim_started_secs: Option<u64>,
    pub claimant: Option<AccountId>,
    pub heirs: Vec<Heir>,
    pub btc_address: Option<String>,
    pub evm_address: Option<String>,
    /// When an heir may start a claim (heartbeat + inactivity).
    pub claimable_after_secs: u64,
    /// When a claim can be finalized, if one is running.
    pub finalizable_after_secs: Option<u64>,
}

/// Shape of the MPC signer's `sign` response (`SignatureResponse::Secp256k1`).
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct SigResponse {
    scheme: String,
    big_r: AffinePoint,
    s: Scalar,
    recovery_id: u8,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct AffinePoint {
    affine_point: String,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct Scalar {
    scalar: String,
}

#[near(serializers = [json])]
pub struct TxArgs {
    inputs: Vec<(String, u32, u64)>, // (txid display hex, vout, value)
    outputs: Vec<(u64, String)>,     // (value, script hex)
}

#[near(serializers = [json])]
pub struct EvmTxArgs {
    nonce: u64,
    max_priority_fee_per_gas: U128,
    max_fee_per_gas: U128,
    gas_limit: u64,
    to: String,
    value: U128,
    data: String,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Kinfolio {
    signer: AccountId,
    btc_hrp: String,
    next_id: u64,
    trusts: LookupMap<u64, Trust>,
    by_owner: LookupMap<AccountId, Vec<u64>>,
    by_heir: LookupMap<AccountId, Vec<u64>>,
    last_signed: LookupMap<u64, SignedTx>,
}

#[near]
impl Kinfolio {
    #[init]
    pub fn new(signer: AccountId, btc_hrp: String) -> Self {
        require!(btc_hrp == "tb" || btc_hrp == "bc", "btc_hrp must be tb or bc");
        Self {
            signer,
            btc_hrp,
            next_id: 0,
            trusts: LookupMap::new(b"t"),
            by_owner: LookupMap::new(b"o"),
            by_heir: LookupMap::new(b"h"),
            last_signed: LookupMap::new(b"s"),
        }
    }

    // ---------------------------------------------------------------- lifecycle

    /// Creates a trust and asks the MPC signer for its derived key. The trust is usable
    /// (has addresses) once the callback lands, a few blocks later.
    pub fn create_trust(&mut self, inactivity_secs: u32, challenge_secs: u32, heirs: Vec<HeirInput>) -> Promise {
        require!(
            inactivity_secs >= MIN_PERIOD_SECS && challenge_secs >= MIN_PERIOD_SECS,
            "periods must be at least 10 seconds"
        );
        require!(!heirs.is_empty() && heirs.len() <= MAX_HEIRS, "1 to 8 heirs");
        let mut seen = HashSet::new();
        let mut total: u32 = 0;
        let mut stored = Vec::with_capacity(heirs.len());
        for h in heirs {
            require!(h.bps > 0, "every heir needs a share");
            require!(seen.insert(h.account.clone()), "duplicate heir");
            self.check_payouts(&h.btc_address, &h.evm_address);
            total += h.bps as u32;
            stored.push(Heir { account: h.account, bps: h.bps, btc_address: h.btc_address, evm_address: h.evm_address });
        }
        require!(total == 10_000, "heir shares must total 10000 bps");

        let owner = env::predecessor_account_id();
        let id = self.next_id;
        self.next_id += 1;
        for h in &stored {
            let mut v = self.by_heir.get(&h.account).cloned().unwrap_or_default();
            v.push(id);
            self.by_heir.insert(h.account.clone(), v);
        }
        let mut mine = self.by_owner.get(&owner).cloned().unwrap_or_default();
        mine.push(id);
        self.by_owner.insert(owner.clone(), mine);
        self.trusts.insert(
            id,
            Trust {
                owner,
                state: State::Active,
                inactivity_secs,
                challenge_secs,
                last_heartbeat_ns: env::block_timestamp(),
                claim_started_ns: None,
                claimant: None,
                heirs: stored,
                pubkey: None,
            },
        );

        let args = near_sdk::serde_json::json!({
            "path": Self::path(id),
            "predecessor": env::current_account_id(),
            "domain_id": SECP256K1_DOMAIN,
        });
        Promise::new(self.signer.clone())
            .function_call("derived_public_key", args.to_string().into_bytes(), NearToken::from_near(0), VIEW_GAS)
            .then(Self::ext(env::current_account_id()).with_static_gas(ON_DERIVED_GAS).on_derived(id))
    }

    #[private]
    pub fn on_derived(&mut self, id: u64, #[callback_result] key: Result<String, PromiseError>) -> bool {
        let parsed = key
            .ok()
            .and_then(|k| PublicKey::from_str(&k).ok())
            .map(|k| k.into_bytes())
            .and_then(|b| match b.len() {
                65 => Some(b[1..].to_vec()), // curve byte + x || y
                64 => Some(b),
                _ => None,
            });
        let trust = self.trusts.get_mut(&id).expect("trust exists");
        match parsed {
            Some(pk) => {
                trust.pubkey = Some(pk);
                log_event("trust_ready", &near_sdk::serde_json::json!({ "id": id }));
                true
            }
            None => {
                // Without a key the trust can never hold anything: unwind it.
                self.remove_trust(id);
                false
            }
        }
    }

    /// The owner says "still here". Spending through the trust does this implicitly.
    pub fn heartbeat(&mut self, id: u64) {
        let trust = self.trust_mut(id);
        require!(env::predecessor_account_id() == trust.owner, "owner only");
        require!(trust.state == State::Active, "trust is not active");
        trust.last_heartbeat_ns = env::block_timestamp();
        log_event("heartbeat", &near_sdk::serde_json::json!({ "id": id, "at": env::block_timestamp() / NS_PER_SEC }));
    }

    /// An heir starts a claim once the owner has been silent for the inactivity period.
    pub fn start_claim(&mut self, id: u64) {
        let now = env::block_timestamp();
        let trust = self.trust_mut(id);
        let caller = env::predecessor_account_id();
        require!(trust.heirs.iter().any(|h| h.account == caller), "heirs only");
        require!(trust.state == State::Active, "a claim is already running or released");
        let claimable = trust.last_heartbeat_ns + trust.inactivity_secs as u64 * NS_PER_SEC;
        require!(now >= claimable, "owner is still within the inactivity period");
        trust.state = State::Challenge;
        trust.claim_started_ns = Some(now);
        trust.claimant = Some(caller.clone());
        log_event("claim_started", &near_sdk::serde_json::json!({ "id": id, "claimant": caller }));
    }

    /// The owner cancels a pending claim. This also counts as a heartbeat.
    pub fn veto(&mut self, id: u64) {
        let trust = self.trust_mut(id);
        require!(env::predecessor_account_id() == trust.owner, "owner only");
        require!(trust.state == State::Challenge, "no claim to veto");
        trust.state = State::Active;
        trust.claim_started_ns = None;
        trust.claimant = None;
        trust.last_heartbeat_ns = env::block_timestamp();
        log_event("claim_vetoed", &near_sdk::serde_json::json!({ "id": id }));
    }

    /// Anyone may finalize once the challenge window has passed without a veto.
    pub fn finalize(&mut self, id: u64) {
        let now = env::block_timestamp();
        let trust = self.trust_mut(id);
        require!(trust.state == State::Challenge, "no claim in progress");
        let done = trust.claim_started_ns.expect("claim time") + trust.challenge_secs as u64 * NS_PER_SEC;
        require!(now >= done, "challenge window is still open");
        trust.state = State::Released;
        log_event("released", &near_sdk::serde_json::json!({ "id": id }));
    }

    /// An heir sets where their share is paid. Callable through a meta-transaction.
    pub fn set_payout(&mut self, id: u64, btc_address: Option<String>, evm_address: Option<String>) {
        self.check_payouts(&btc_address, &evm_address);
        let caller = env::predecessor_account_id();
        let trust = self.trust_mut(id);
        let heir = trust.heirs.iter_mut().find(|h| h.account == caller).unwrap_or_else(|| env::panic_str("heirs only"));
        heir.btc_address = btc_address;
        heir.evm_address = evm_address;
    }

    // ---------------------------------------------------------------- owner spends (proof of life)

    /// The owner spends BTC from the trust. The contract builds the transaction, so the only
    /// recipient other than the trust itself (change) is `to`, and the fee is capped. A successful
    /// signature counts as a heartbeat: using the money is the proof that you're alive.
    pub fn owner_sign_btc(&mut self, id: u64, utxos: Vec<Utxo>, to: String, amount_sats: u64, fee_sats: u64) -> Promise {
        let (key_hash, _) = {
            let trust = self.trust(id);
            require!(env::predecessor_account_id() == trust.owner, "owner only");
            require!(trust.state == State::Active, "trust is not active");
            Self::btc_keys(trust)
        };
        let to_hash = btc::decode_p2wpkh(&self.btc_hrp, &to).unwrap_or_else(|e| env::panic_str(&e));
        let mut tx = Self::build_tx(&utxos, fee_sats);
        require!(amount_sats > 0, "amount must be positive");
        let total = tx.total_in();
        require!(amount_sats + fee_sats <= total, "inputs do not cover amount plus fee");
        let change = total - amount_sats - fee_sats;
        require!(change == 0 || change >= btc::DUST_SATS, "change would be dust; adjust the amount");
        require!(amount_sats >= btc::DUST_SATS, "amount is dust");
        tx.outputs.push(btc::Output { value: amount_sats, script: btc::p2wpkh_script(&to_hash) });
        if change > 0 {
            tx.outputs.push(btc::Output { value: change, script: btc::p2wpkh_script(&key_hash) });
        }
        self.request_btc_signatures(id, tx, &key_hash, "owner_spend")
    }

    #[private]
    pub fn on_btc_signed(&mut self, id: u64, tx: TxArgs, reason: String) -> SignedTx {
        let tx = tx_from_args(tx);
        let (_, pubkey33) = Self::btc_keys(self.trust(id));
        let witnesses: Vec<(Vec<u8>, [u8; 33])> = (0..tx.inputs.len())
            .map(|i| {
                let raw = env::promise_result_checked(i as u64, 4096)
                    .unwrap_or_else(|_| env::panic_str("signer did not return a signature"));
                let resp: SigResponse = near_sdk::serde_json::from_slice(&raw).expect("signature json");
                require!(resp.scheme == "Secp256k1", "unexpected signature scheme");
                let big_r = hex::decode(&resp.big_r.affine_point).expect("big_r hex");
                let mut r = [0u8; 32];
                r.copy_from_slice(&big_r[1..33]); // x coordinate of the nonce point
                let mut s = [0u8; 32];
                hex::decode_to_slice(&resp.s.scalar, &mut s).expect("s hex");
                (btc::der_signature(&r, &s), pubkey33)
            })
            .collect();
        let signed = SignedTx {
            chain: "btc".into(),
            raw_hex: hex::encode(tx.serialize_signed(&witnesses)),
            txid: btc::txid_display(&tx.txid_le()),
            signed_at_secs: env::block_timestamp() / NS_PER_SEC,
        };
        if reason == "owner_spend" {
            let trust = self.trust_mut(id);
            trust.last_heartbeat_ns = env::block_timestamp();
        }
        self.last_signed.insert(id, signed.clone());
        log_event("btc_signed", &near_sdk::serde_json::json!({ "id": id, "txid": signed.txid, "reason": reason }));
        signed
    }


    // ---------------------------------------------------------------- distribution (after release)

    /// Pays the trust's BTC to the heirs by share. Anyone may call it (the keeper does), because the
    /// contract picks the outputs: each heir's registered address gets `bps x (inputs - fee)`, the
    /// last heir takes the rounding remainder. Inputs the caller leaves out stay for a later call,
    /// and lying about an input's value only produces a signature the network rejects (BIP-143).
    pub fn distribute_btc(&mut self, id: u64, utxos: Vec<Utxo>, fee_sats: u64) -> Promise {
        let trust = self.trust(id);
        require!(trust.state == State::Released, "trust is not released");
        let (key_hash, _) = Self::btc_keys(trust);
        let payees: Vec<([u8; 20], u16)> = trust
            .heirs
            .iter()
            .map(|h| {
                let addr = h.btc_address.as_ref().unwrap_or_else(|| env::panic_str(&format!("{} has no btc payout address", h.account)));
                (btc::decode_p2wpkh(&self.btc_hrp, addr).expect("checked on set"), h.bps)
            })
            .collect();
        let mut tx = Self::build_tx(&utxos, fee_sats);
        let total = tx.total_in();
        require!(total > fee_sats, "inputs do not cover the fee");
        let amounts = split_by_bps(total - fee_sats, &payees.iter().map(|p| p.1).collect::<Vec<_>>());
        for ((hash, _), amount) in payees.iter().zip(amounts) {
            require!(amount >= btc::DUST_SATS, "an heir's share would be dust");
            tx.outputs.push(btc::Output { value: amount, script: btc::p2wpkh_script(hash) });
        }
        self.request_btc_signatures(id, tx, &key_hash, "distribute")
    }

    /// Pays the trust's ETH to the heirs through `KinfolioSplitter.split`, which divides `value_wei`
    /// by share on-chain. The caller supplies nonce, gas and value; the contract caps the fee and
    /// builds the calldata from its own heir list, so a lying caller can't change who gets what share.
    pub fn distribute_evm(
        &mut self,
        id: u64,
        nonce: u64,
        max_fee_per_gas: U128,
        max_priority_fee_per_gas: U128,
        gas_limit: u64,
        value_wei: U128,
    ) -> Promise {
        let trust = self.trust(id);
        require!(trust.state == State::Released, "trust is not released");
        require!(trust.pubkey.is_some(), "trust key is not derived yet");
        require!(gas_limit > 0 && gas_limit <= MAX_EVM_GAS_LIMIT, "gas_limit out of range");
        require!(max_priority_fee_per_gas.0 <= max_fee_per_gas.0, "priority fee above max fee");
        require!(max_fee_per_gas.0.saturating_mul(gas_limit as u128) <= MAX_EVM_FEE_WEI, "fee above the 0.001 ETH cap");
        require!(value_wei.0 > 0, "nothing to distribute");
        let splitter = self.splitter().unwrap_or_else(|| env::panic_str("splitter is not configured"));
        let (to, bps): (Vec<[u8; 20]>, Vec<u16>) = trust
            .heirs
            .iter()
            .map(|h| {
                let addr = h.evm_address.as_ref().unwrap_or_else(|| env::panic_str(&format!("{} has no evm payout address", h.account)));
                (evm::parse_address(addr).expect("checked on set"), h.bps)
            })
            .unzip();
        let tx = evm::Tx {
            chain_id: EVM_CHAIN_ID,
            nonce,
            max_priority_fee_per_gas: max_priority_fee_per_gas.0,
            max_fee_per_gas: max_fee_per_gas.0,
            gas_limit,
            to: splitter,
            value: value_wei.0,
            data: evm::split_calldata(&to, &bps),
        };
        let args = near_sdk::serde_json::json!({
            "request": {
                "path": Self::path(id),
                "payload_v2": { "Ecdsa": hex::encode(tx.sighash()) },
                "domain_id": SECP256K1_DOMAIN,
            }
        });
        let tx_args = EvmTxArgs {
            nonce,
            max_priority_fee_per_gas,
            max_fee_per_gas,
            gas_limit,
            to: format!("0x{}", hex::encode(tx.to)),
            value: value_wei,
            data: hex::encode(&tx.data),
        };
        Promise::new(self.signer.clone())
            .function_call_weight("sign", args.to_string().into_bytes(), SIGN_DEPOSIT, SIGN_GAS, GasWeight(0))
            .then(Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_evm_signed(id, tx_args))
    }

    #[private]
    pub fn on_evm_signed(&mut self, id: u64, tx: EvmTxArgs) -> SignedTx {
        let raw = env::promise_result_checked(0, 4096).unwrap_or_else(|_| env::panic_str("signer did not return a signature"));
        let resp: SigResponse = near_sdk::serde_json::from_slice(&raw).expect("signature json");
        require!(resp.scheme == "Secp256k1", "unexpected signature scheme");
        let big_r = hex::decode(&resp.big_r.affine_point).expect("big_r hex");
        let mut r = [0u8; 32];
        r.copy_from_slice(&big_r[1..33]);
        let mut s = [0u8; 32];
        hex::decode_to_slice(&resp.s.scalar, &mut s).expect("s hex");
        // Ethereum only accepts low-S; flipping S to N - S also flips the recovery parity.
        let low = btc::normalize_s(s);
        let y_parity = if low != s { resp.recovery_id ^ 1 } else { resp.recovery_id };
        let tx = evm::Tx {
            chain_id: EVM_CHAIN_ID,
            nonce: tx.nonce,
            max_priority_fee_per_gas: tx.max_priority_fee_per_gas.0,
            max_fee_per_gas: tx.max_fee_per_gas.0,
            gas_limit: tx.gas_limit,
            to: evm::parse_address(&tx.to).expect("to"),
            value: tx.value.0,
            data: hex::decode(&tx.data).expect("data hex"),
        };
        let signed_bytes = tx.serialize_signed(y_parity, &r, &low);
        let signed = SignedTx {
            chain: "evm".into(),
            raw_hex: format!("0x{}", hex::encode(&signed_bytes)),
            txid: evm::tx_hash(&signed_bytes),
            signed_at_secs: env::block_timestamp() / NS_PER_SEC,
        };
        env::storage_write(&evm_key(id), &near_sdk::borsh::to_vec(&signed).expect("borsh"));
        log_event("evm_signed", &near_sdk::serde_json::json!({ "id": id, "tx_hash": signed.txid, "reason": "distribute" }));
        signed
    }

    /// One-time setting of the Base Sepolia splitter. Only the contract account itself can call it,
    /// and it can't be changed afterwards.
    #[private]
    pub fn set_splitter(&mut self, address: String) {
        require!(self.splitter().is_none(), "splitter is already set");
        let a = evm::parse_address(&address).unwrap_or_else(|e| env::panic_str(&e));
        env::storage_write(SPLITTER_KEY, &a);
    }

    // ---------------------------------------------------------------- views

    pub fn get_trust(&self, id: u64) -> Option<TrustView> {
        self.trusts.get(&id).map(|t| self.view(id, t))
    }

    pub fn trusts_of(&self, owner: AccountId) -> Vec<TrustView> {
        self.views(self.by_owner.get(&owner))
    }

    pub fn trusts_for(&self, heir: AccountId) -> Vec<TrustView> {
        self.views(self.by_heir.get(&heir))
    }

    pub fn get_last_signed(&self, id: u64) -> Option<SignedTx> {
        self.last_signed.get(&id).cloned()
    }

    pub fn get_last_signed_evm(&self, id: u64) -> Option<SignedTx> {
        env::storage_read(&evm_key(id)).map(|b| near_sdk::borsh::from_slice(&b).expect("borsh"))
    }

    pub fn get_splitter(&self) -> Option<String> {
        self.splitter().map(|a| format!("0x{}", hex::encode(a)))
    }

    pub fn get_config(&self) -> (AccountId, String) {
        (self.signer.clone(), self.btc_hrp.clone())
    }

    pub fn next_trust_id(&self) -> U64 {
        U64(self.next_id)
    }
}

// -------------------------------------------------------------------- internals

impl Kinfolio {
    fn path(id: u64) -> String {
        format!("trust-{id}")
    }

    fn trust(&self, id: u64) -> &Trust {
        self.trusts.get(&id).unwrap_or_else(|| env::panic_str("no such trust"))
    }

    fn trust_mut(&mut self, id: u64) -> &mut Trust {
        self.trusts.get_mut(&id).unwrap_or_else(|| env::panic_str("no such trust"))
    }

    fn splitter(&self) -> Option<[u8; 20]> {
        env::storage_read(SPLITTER_KEY).and_then(|b| b.try_into().ok())
    }

    fn btc_keys(trust: &Trust) -> ([u8; 20], [u8; 33]) {
        let xy: [u8; 64] = trust
            .pubkey
            .as_ref()
            .unwrap_or_else(|| env::panic_str("trust key is not derived yet"))
            .as_slice()
            .try_into()
            .expect("64-byte key");
        let compressed = btc::compress(&xy);
        (btc::hash160(&compressed), compressed)
    }

    fn evm_address(trust: &Trust) -> Option<String> {
        let xy = trust.pubkey.as_ref()?;
        let hash = env::keccak256(xy);
        Some(format!("0x{}", hex::encode(&hash[12..])))
    }

    fn check_payouts(&self, btc_address: &Option<String>, evm_address: &Option<String>) {
        if let Some(a) = btc_address {
            btc::decode_p2wpkh(&self.btc_hrp, a).unwrap_or_else(|e| env::panic_str(&e));
        }
        if let Some(a) = evm_address {
            let ok = a.len() == 42 && a.starts_with("0x") && a[2..].chars().all(|c| c.is_ascii_hexdigit());
            require!(ok, "evm address must be 0x followed by 40 hex characters");
        }
    }

    fn build_tx(utxos: &[Utxo], fee_sats: u64) -> btc::Tx {
        require!(!utxos.is_empty() && utxos.len() <= MAX_INPUTS, "1 to 3 inputs");
        require!(fee_sats > 0 && fee_sats <= MAX_FEE_SATS, "fee must be between 1 and 50000 sats");
        let inputs = utxos
            .iter()
            .map(|u| btc::Input {
                txid_le: btc::txid_le(&u.txid).unwrap_or_else(|e| env::panic_str(&e)),
                vout: u.vout,
                value: u.value,
            })
            .collect();
        btc::Tx { inputs, outputs: vec![] }
    }

    /// One `sign` call per input, joined, then a single callback that assembles the transaction.
    fn request_btc_signatures(&self, id: u64, tx: btc::Tx, key_hash: &[u8; 20], reason: &str) -> Promise {
        let mut calls: Option<Promise> = None;
        for i in 0..tx.inputs.len() {
            let hash = tx.sighash(i, key_hash);
            let args = near_sdk::serde_json::json!({
                "request": {
                    "path": Self::path(id),
                    "payload_v2": { "Ecdsa": hex::encode(hash) },
                    "domain_id": SECP256K1_DOMAIN,
                }
            });
            let call = Promise::new(self.signer.clone()).function_call_weight(
                "sign",
                args.to_string().into_bytes(),
                SIGN_DEPOSIT,
                SIGN_GAS,
                GasWeight(0),
            );
            calls = Some(match calls {
                Some(p) => p.and(call),
                None => call,
            });
        }
        let args = tx_to_args(&tx);
        calls.expect("at least one input").then(
            Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_btc_signed(id, args, reason.to_string()),
        )
    }

    fn view(&self, id: u64, t: &Trust) -> TrustView {
        let (btc_address, evm_address) = match &t.pubkey {
            Some(_) => {
                let (h, _) = Self::btc_keys(t);
                (Some(btc::address(&self.btc_hrp, &h)), Self::evm_address(t))
            }
            None => (None, None),
        };
        TrustView {
            id,
            owner: t.owner.clone(),
            state: t.state,
            inactivity_secs: t.inactivity_secs,
            challenge_secs: t.challenge_secs,
            last_heartbeat_secs: t.last_heartbeat_ns / NS_PER_SEC,
            claim_started_secs: t.claim_started_ns.map(|n| n / NS_PER_SEC),
            claimant: t.claimant.clone(),
            heirs: t.heirs.clone(),
            btc_address,
            evm_address,
            claimable_after_secs: t.last_heartbeat_ns / NS_PER_SEC + t.inactivity_secs as u64,
            finalizable_after_secs: t.claim_started_ns.map(|n| n / NS_PER_SEC + t.challenge_secs as u64),
        }
    }

    fn views(&self, ids: Option<&Vec<u64>>) -> Vec<TrustView> {
        ids.map(|v| v.iter().filter_map(|id| self.trusts.get(id).map(|t| self.view(*id, t))).collect()).unwrap_or_default()
    }

    fn remove_trust(&mut self, id: u64) {
        if let Some(t) = self.trusts.remove(&id) {
            if let Some(v) = self.by_owner.get_mut(&t.owner) {
                v.retain(|x| *x != id);
            }
            for h in t.heirs {
                if let Some(v) = self.by_heir.get_mut(&h.account) {
                    v.retain(|x| *x != id);
                }
            }
        }
    }
}

fn evm_key(id: u64) -> Vec<u8> {
    [LAST_EVM_PREFIX, &id.to_le_bytes()].concat()
}

/// Splits `total` by basis points; the last share takes the rounding remainder.
fn split_by_bps(total: u64, bps: &[u16]) -> Vec<u64> {
    let mut left = total;
    bps.iter()
        .enumerate()
        .map(|(i, b)| {
            let amount = if i == bps.len() - 1 { left } else { (total as u128 * *b as u128 / 10_000) as u64 };
            left -= amount;
            amount
        })
        .collect()
}

fn tx_to_args(tx: &btc::Tx) -> TxArgs {
    TxArgs {
        inputs: tx.inputs.iter().map(|i| (btc::txid_display(&i.txid_le), i.vout, i.value)).collect(),
        outputs: tx.outputs.iter().map(|o| (o.value, hex::encode(&o.script))).collect(),
    }
}

fn tx_from_args(a: TxArgs) -> btc::Tx {
    btc::Tx {
        inputs: a
            .inputs
            .into_iter()
            .map(|(txid, vout, value)| btc::Input { txid_le: btc::txid_le(&txid).expect("txid"), vout, value })
            .collect(),
        outputs: a
            .outputs
            .into_iter()
            .map(|(value, script)| btc::Output { value, script: hex::decode(script).expect("script hex") })
            .collect(),
    }
}

fn log_event(name: &str, data: &near_sdk::serde_json::Value) {
    env::log_str(&format!("EVENT_JSON:{}", near_sdk::serde_json::json!({ "standard": "kinfolio", "event": name, "data": data })));
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    const T0: u64 = 1_000_000 * NS_PER_SEC;

    fn ctx(predecessor: AccountId, at_ns: u64) {
        testing_env!(VMContextBuilder::new().predecessor_account_id(predecessor).block_timestamp(at_ns).build());
    }

    fn heirs() -> Vec<HeirInput> {
        vec![
            HeirInput { account: accounts(1), bps: 6_000, btc_address: None, evm_address: None },
            HeirInput { account: accounts(2), bps: 4_000, btc_address: None, evm_address: None },
        ]
    }

    /// A trust that already has its derived key, as after a successful MPC callback.
    fn ready() -> Kinfolio {
        ctx(accounts(0), T0);
        let mut c = Kinfolio::new("signer.testnet".parse().unwrap(), "tb".into());
        let _ = c.create_trust(60, 30, heirs());
        c.trust_mut(0).pubkey = Some((0u8..64).collect());
        c
    }

    #[test]
    #[should_panic(expected = "heir shares must total 10000 bps")]
    fn shares_must_total_100_percent() {
        ctx(accounts(0), T0);
        let mut c = Kinfolio::new("signer.testnet".parse().unwrap(), "tb".into());
        let mut h = heirs();
        h[1].bps = 3_000;
        let _ = c.create_trust(60, 30, h);
    }

    #[test]
    #[should_panic(expected = "owner is still within the inactivity period")]
    fn heir_cannot_claim_while_owner_is_active() {
        let mut c = ready();
        ctx(accounts(1), T0 + 59 * NS_PER_SEC);
        c.start_claim(0);
    }

    #[test]
    #[should_panic(expected = "heirs only")]
    fn stranger_cannot_claim() {
        let mut c = ready();
        ctx(accounts(3), T0 + 61 * NS_PER_SEC);
        c.start_claim(0);
    }

    #[test]
    fn full_release_path() {
        let mut c = ready();
        ctx(accounts(1), T0 + 61 * NS_PER_SEC);
        c.start_claim(0);
        assert_eq!(c.trust(0).state, State::Challenge);
        ctx(accounts(3), T0 + (61 + 30) * NS_PER_SEC);
        c.finalize(0);
        assert_eq!(c.trust(0).state, State::Released);
    }

    #[test]
    #[should_panic(expected = "challenge window is still open")]
    fn cannot_finalize_inside_the_window() {
        let mut c = ready();
        ctx(accounts(1), T0 + 61 * NS_PER_SEC);
        c.start_claim(0);
        ctx(accounts(1), T0 + 80 * NS_PER_SEC);
        c.finalize(0);
    }

    #[test]
    fn owner_veto_resets_the_clock() {
        let mut c = ready();
        ctx(accounts(1), T0 + 61 * NS_PER_SEC);
        c.start_claim(0);
        ctx(accounts(0), T0 + 70 * NS_PER_SEC);
        c.veto(0);
        let t = c.trust(0);
        assert_eq!(t.state, State::Active);
        assert_eq!(t.last_heartbeat_ns, T0 + 70 * NS_PER_SEC);
        assert!(t.claimant.is_none());
    }

    #[test]
    #[should_panic(expected = "owner only")]
    fn only_the_owner_can_veto() {
        let mut c = ready();
        ctx(accounts(1), T0 + 61 * NS_PER_SEC);
        c.start_claim(0);
        c.veto(0);
    }

    #[test]
    fn heartbeat_pushes_out_claimability() {
        let mut c = ready();
        ctx(accounts(0), T0 + 50 * NS_PER_SEC);
        c.heartbeat(0);
        assert_eq!(c.get_trust(0).unwrap().claimable_after_secs, 1_000_000 + 50 + 60);
    }

    #[test]
    fn views_expose_addresses_once_derived() {
        let c = ready();
        let v = c.get_trust(0).unwrap();
        assert!(v.btc_address.unwrap().starts_with("tb1q"));
        assert_eq!(v.evm_address.unwrap().len(), 42);
        assert_eq!(c.trusts_for(accounts(1)).len(), 1);
        assert_eq!(c.trusts_of(accounts(0)).len(), 1);
    }

    #[test]
    #[should_panic(expected = "fee must be between 1 and 50000 sats")]
    fn fee_is_capped_by_the_contract() {
        let mut c = ready();
        ctx(accounts(0), T0);
        let utxo = Utxo { txid: "11".repeat(32), vout: 0, value: 1_000_000 };
        let to = btc::address("tb", &[7u8; 20]);
        let _ = c.owner_sign_btc(0, vec![utxo], to, 10_000, 50_001);
    }

    #[test]
    #[should_panic(expected = "address is for network")]
    fn mainnet_address_is_refused_on_testnet_contract() {
        let mut c = ready();
        ctx(accounts(0), T0);
        let utxo = Utxo { txid: "11".repeat(32), vout: 0, value: 1_000_000 };
        let _ = c.owner_sign_btc(0, vec![utxo], btc::address("bc", &[7u8; 20]), 10_000, 500);
    }

    #[test]
    #[should_panic(expected = "owner only")]
    fn only_the_owner_can_spend() {
        let mut c = ready();
        ctx(accounts(1), T0);
        let utxo = Utxo { txid: "11".repeat(32), vout: 0, value: 1_000_000 };
        let _ = c.owner_sign_btc(0, vec![utxo], btc::address("tb", &[7u8; 20]), 10_000, 500);
    }

    fn released() -> Kinfolio {
        let mut c = ready();
        ctx(accounts(1), T0 + 61 * NS_PER_SEC);
        c.start_claim(0);
        ctx(accounts(3), T0 + 91 * NS_PER_SEC);
        c.finalize(0);
        c
    }

    fn register_payouts(c: &mut Kinfolio) {
        for (i, who) in [accounts(1), accounts(2)].into_iter().enumerate() {
            ctx(who, T0 + 92 * NS_PER_SEC);
            c.set_payout(0, Some(btc::address("tb", &[i as u8 + 1; 20])), Some(format!("0x{}", hex::encode([i as u8 + 1; 20]))));
        }
    }

    #[test]
    fn shares_split_by_bps_with_remainder_to_last() {
        assert_eq!(split_by_bps(10_001, &[6_000, 4_000]), vec![6_000, 4_001]);
        assert_eq!(split_by_bps(49_700, &[3_333, 3_333, 3_334]).iter().sum::<u64>(), 49_700);
    }

    #[test]
    #[should_panic(expected = "trust is not released")]
    fn cannot_distribute_while_owner_is_alive() {
        let mut c = ready();
        ctx(accounts(3), T0);
        let utxo = Utxo { txid: "11".repeat(32), vout: 0, value: 100_000 };
        let _ = c.distribute_btc(0, vec![utxo], 500);
    }

    #[test]
    #[should_panic(expected = "has no btc payout address")]
    fn btc_distribution_needs_every_heir_address() {
        let mut c = released();
        let utxo = Utxo { txid: "11".repeat(32), vout: 0, value: 100_000 };
        let _ = c.distribute_btc(0, vec![utxo], 500);
    }

    #[test]
    fn released_trust_distributes_btc_and_keeps_heartbeat() {
        let mut c = released();
        register_payouts(&mut c);
        let before = c.trust(0).last_heartbeat_ns;
        let utxo = Utxo { txid: "11".repeat(32), vout: 0, value: 100_000 };
        let _ = c.distribute_btc(0, vec![utxo], 500);
        assert_eq!(c.trust(0).last_heartbeat_ns, before);
    }

    #[test]
    #[should_panic(expected = "an heir's share would be dust")]
    fn btc_distribution_refuses_dust_shares() {
        let mut c = released();
        register_payouts(&mut c);
        let utxo = Utxo { txid: "11".repeat(32), vout: 0, value: 1_500 };
        let _ = c.distribute_btc(0, vec![utxo], 500);
    }

    #[test]
    #[should_panic(expected = "splitter is not configured")]
    fn evm_distribution_needs_the_splitter() {
        let mut c = released();
        register_payouts(&mut c);
        let _ = c.distribute_evm(0, 0, U128(1_000_000), U128(1_000), 100_000, U128(1_000_000_000));
    }

    #[test]
    #[should_panic(expected = "fee above the 0.001 ETH cap")]
    fn evm_fee_is_capped_by_the_contract() {
        let mut c = released();
        register_payouts(&mut c);
        let _ = c.distribute_evm(0, 0, U128(10_000_000_000_000), U128(1), 300_000, U128(1));
    }

    #[test]
    fn evm_distribution_builds_with_splitter_set() {
        let mut c = released();
        register_payouts(&mut c);
        testing_env!(VMContextBuilder::new()
            .current_account_id("contract.testnet".parse().unwrap())
            .predecessor_account_id("contract.testnet".parse().unwrap())
            .block_timestamp(T0 + 93 * NS_PER_SEC)
            .build());
        c.set_splitter(format!("0x{}", "ab".repeat(20)));
        assert_eq!(c.get_splitter().unwrap(), format!("0x{}", "ab".repeat(20)));
        let _ = c.distribute_evm(0, 0, U128(1_000_000), U128(1_000), 100_000, U128(1_000_000_000));
    }

    #[test]
    #[should_panic(expected = "splitter is already set")]
    fn splitter_can_only_be_set_once() {
        let mut c = ready();
        testing_env!(VMContextBuilder::new()
            .current_account_id("contract.testnet".parse().unwrap())
            .predecessor_account_id("contract.testnet".parse().unwrap())
            .build());
        c.set_splitter(format!("0x{}", "ab".repeat(20)));
        c.set_splitter(format!("0x{}", "cd".repeat(20)));
    }
}
