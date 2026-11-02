//! Offline check of a transaction signed by the trust: parses the raw hex with rust-bitcoin,
//! recomputes the BIP-143 sighash and verifies every witness signature against its public key,
//! then confirms the key hashes to the trust's address (the change output).
//!
//!   cargo run --example verify_signed -- <raw_hex> <input_value_sats>...
use bitcoin::consensus::deserialize;
use bitcoin::ecdsa::Signature;
use bitcoin::hashes::{hash160, Hash};
use bitcoin::secp256k1::{Message, PublicKey, Secp256k1};
use bitcoin::sighash::SighashCache;
use bitcoin::{Amount, ScriptBuf, Transaction};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let raw = hex::decode(&args[0]).expect("hex");
    let tx: Transaction = deserialize(&raw).expect("valid segwit transaction");
    let values: Vec<u64> = args[1..].iter().map(|v| v.parse().expect("sats")).collect();
    assert_eq!(values.len(), tx.input.len(), "one input value per input");

    let secp = Secp256k1::verification_only();
    let mut cache = SighashCache::new(&tx);
    for (i, input) in tx.input.iter().enumerate() {
        let sig = Signature::from_slice(&input.witness[0]).expect("DER signature + sighash byte");
        let pubkey = PublicKey::from_slice(&input.witness[1]).expect("compressed key");
        let key_hash = hash160::Hash::hash(&input.witness[1]).to_byte_array();
        let mut program = vec![0x00, 0x14];
        program.extend_from_slice(&key_hash);
        let script = ScriptBuf::from_bytes(program);
        let sighash = cache
            .p2wpkh_signature_hash(i, &script, Amount::from_sat(values[i]), sig.sighash_type)
            .expect("sighash");
        let msg = Message::from_digest(sighash.to_byte_array());
        secp.verify_ecdsa(&msg, &sig.signature, &pubkey).expect("signature must verify");
        println!("input {i}: signature VERIFIES against {}", hex::encode(input.witness[1].to_vec()));
        println!("input {i}: key hashes to program {}", hex::encode(key_hash));
        let pays_back = tx.output.iter().any(|o| o.script_pubkey.as_bytes() == script.as_bytes());
        println!("input {i}: change pays back to the signing key: {pays_back}");
    }
    println!("txid {}", tx.compute_txid());
}
