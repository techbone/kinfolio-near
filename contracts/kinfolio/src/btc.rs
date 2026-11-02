//! Bitcoin helpers for P2WPKH (BIP-143): addresses, the transaction the trust signs,
//! its sighashes, and assembly of the final witness transaction.
//!
//! The trust only ever spends P2WPKH outputs that pay to its own derived key, so this
//! is deliberately the one script type implemented, with no general transaction builder.

use bech32::{segwit, Fe32, Hrp};
use ripemd::Ripemd160;
use sha2::{Digest, Sha256};

pub const SEQUENCE: u32 = 0xffff_fffd; // opts in to RBF
pub const SIGHASH_ALL: u32 = 1;
pub const DUST_SATS: u64 = 546;

/// secp256k1 group order, big endian.
const N: [u8; 32] = [
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xfe,
    0xba, 0xae, 0xdc, 0xe6, 0xaf, 0x48, 0xa0, 0x3b, 0xbf, 0xd2, 0x5e, 0x8c, 0xd0, 0x36, 0x41, 0x41,
];

pub fn sha256d(data: &[u8]) -> [u8; 32] {
    Sha256::digest(Sha256::digest(data)).into()
}

pub fn hash160(data: &[u8]) -> [u8; 20] {
    Ripemd160::digest(Sha256::digest(data)).into()
}

/// 33-byte compressed key from the 64-byte uncompressed (x || y) form NEAR uses.
pub fn compress(xy: &[u8; 64]) -> [u8; 33] {
    let mut out = [0u8; 33];
    out[0] = if xy[63] & 1 == 0 { 0x02 } else { 0x03 };
    out[1..].copy_from_slice(&xy[..32]);
    out
}

pub fn p2wpkh_script(h160: &[u8; 20]) -> Vec<u8> {
    let mut s = vec![0x00, 0x14];
    s.extend_from_slice(h160);
    s
}

pub fn address(hrp: &str, h160: &[u8; 20]) -> String {
    let hrp = Hrp::parse(hrp).expect("invalid bech32 hrp");
    segwit::encode_v0(hrp, h160).expect("encode address")
}

/// Decodes a native segwit v0 20-byte address (P2WPKH) for the expected network.
pub fn decode_p2wpkh(hrp: &str, addr: &str) -> Result<[u8; 20], String> {
    let (got, version, program) = segwit::decode(addr).map_err(|e| format!("bad address: {e}"))?;
    if got.as_str() != hrp {
        return Err(format!("address is for network {}, expected {}", got, hrp));
    }
    if version != Fe32::Q || program.len() != 20 {
        return Err("only native segwit v0 (bc1q / tb1q) P2WPKH addresses are supported".into());
    }
    let mut out = [0u8; 20];
    out.copy_from_slice(&program);
    Ok(out)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Input {
    /// Transaction id in internal (little-endian) byte order.
    pub txid_le: [u8; 32],
    pub vout: u32,
    pub value: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Output {
    pub value: u64,
    pub script: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Tx {
    pub inputs: Vec<Input>,
    pub outputs: Vec<Output>,
}

/// Parses a display-order (big-endian) txid hex string into internal byte order.
pub fn txid_le(display_hex: &str) -> Result<[u8; 32], String> {
    let mut bytes = [0u8; 32];
    hex::decode_to_slice(display_hex, &mut bytes).map_err(|_| "txid must be 64 hex chars".to_string())?;
    bytes.reverse();
    Ok(bytes)
}

pub fn txid_display(txid_le: &[u8; 32]) -> String {
    let mut b = *txid_le;
    b.reverse();
    hex::encode(b)
}

fn varint(out: &mut Vec<u8>, n: usize) {
    match n {
        0..=0xfc => out.push(n as u8),
        0xfd..=0xffff => {
            out.push(0xfd);
            out.extend_from_slice(&(n as u16).to_le_bytes());
        }
        _ => {
            out.push(0xfe);
            out.extend_from_slice(&(n as u32).to_le_bytes());
        }
    }
}

fn serialize_outputs(outputs: &[Output]) -> Vec<u8> {
    let mut out = Vec::new();
    for o in outputs {
        out.extend_from_slice(&o.value.to_le_bytes());
        varint(&mut out, o.script.len());
        out.extend_from_slice(&o.script);
    }
    out
}

impl Tx {
    pub fn total_in(&self) -> u64 {
        self.inputs.iter().map(|i| i.value).sum()
    }

    pub fn total_out(&self) -> u64 {
        self.outputs.iter().map(|o| o.value).sum()
    }

    /// BIP-143 signature hash for input `index`, SIGHASH_ALL, spending a P2WPKH output
    /// that pays to `key_hash`. The amount is committed to by the hash, so a wrong
    /// caller-supplied input value produces a signature the network rejects.
    pub fn sighash(&self, index: usize, key_hash: &[u8; 20]) -> [u8; 32] {
        let mut prevouts = Vec::new();
        let mut sequences = Vec::new();
        for i in &self.inputs {
            prevouts.extend_from_slice(&i.txid_le);
            prevouts.extend_from_slice(&i.vout.to_le_bytes());
            sequences.extend_from_slice(&SEQUENCE.to_le_bytes());
        }
        let input = &self.inputs[index];

        let mut pre = Vec::with_capacity(160);
        pre.extend_from_slice(&2u32.to_le_bytes()); // version
        pre.extend_from_slice(&sha256d(&prevouts));
        pre.extend_from_slice(&sha256d(&sequences));
        pre.extend_from_slice(&input.txid_le);
        pre.extend_from_slice(&input.vout.to_le_bytes());
        // scriptCode for P2WPKH: OP_DUP OP_HASH160 <h160> OP_EQUALVERIFY OP_CHECKSIG, length-prefixed
        pre.extend_from_slice(&[0x19, 0x76, 0xa9, 0x14]);
        pre.extend_from_slice(key_hash);
        pre.extend_from_slice(&[0x88, 0xac]);
        pre.extend_from_slice(&input.value.to_le_bytes());
        pre.extend_from_slice(&SEQUENCE.to_le_bytes());
        pre.extend_from_slice(&sha256d(&serialize_outputs(&self.outputs)));
        pre.extend_from_slice(&0u32.to_le_bytes()); // locktime
        pre.extend_from_slice(&SIGHASH_ALL.to_le_bytes());
        sha256d(&pre)
    }

    /// Serializes the fully signed segwit transaction. `witnesses[i]` is the
    /// DER signature (with the sighash byte appended) and the compressed key for input i.
    pub fn serialize_signed(&self, witnesses: &[(Vec<u8>, [u8; 33])]) -> Vec<u8> {
        assert_eq!(witnesses.len(), self.inputs.len(), "one witness per input");
        let mut out = Vec::new();
        out.extend_from_slice(&2u32.to_le_bytes());
        out.extend_from_slice(&[0x00, 0x01]); // segwit marker + flag
        varint(&mut out, self.inputs.len());
        for i in &self.inputs {
            out.extend_from_slice(&i.txid_le);
            out.extend_from_slice(&i.vout.to_le_bytes());
            out.push(0x00); // empty scriptSig
            out.extend_from_slice(&SEQUENCE.to_le_bytes());
        }
        varint(&mut out, self.outputs.len());
        out.extend_from_slice(&serialize_outputs(&self.outputs));
        for (sig, pubkey) in witnesses {
            out.push(0x02);
            varint(&mut out, sig.len());
            out.extend_from_slice(sig);
            varint(&mut out, pubkey.len());
            out.extend_from_slice(pubkey);
        }
        out.extend_from_slice(&0u32.to_le_bytes());
        out
    }

    /// The txid: double SHA-256 of the serialization without witness data.
    pub fn txid_le(&self) -> [u8; 32] {
        let mut out = Vec::new();
        out.extend_from_slice(&2u32.to_le_bytes());
        varint(&mut out, self.inputs.len());
        for i in &self.inputs {
            out.extend_from_slice(&i.txid_le);
            out.extend_from_slice(&i.vout.to_le_bytes());
            out.push(0x00);
            out.extend_from_slice(&SEQUENCE.to_le_bytes());
        }
        varint(&mut out, self.outputs.len());
        out.extend_from_slice(&serialize_outputs(&self.outputs));
        out.extend_from_slice(&0u32.to_le_bytes());
        sha256d(&out)
    }
}

fn gt(a: &[u8; 32], b: &[u8; 32]) -> bool {
    a > b // big-endian byte arrays compare lexicographically as integers
}

fn sub(a: &[u8; 32], b: &[u8; 32]) -> [u8; 32] {
    let mut out = [0u8; 32];
    let mut borrow = 0i16;
    for i in (0..32).rev() {
        let mut d = a[i] as i16 - b[i] as i16 - borrow;
        borrow = if d < 0 { d += 256; 1 } else { 0 };
        out[i] = d as u8;
    }
    out
}

/// Bitcoin relay policy requires low-S signatures (S <= N/2).
pub fn normalize_s(s: [u8; 32]) -> [u8; 32] {
    let mut half = N;
    // N / 2: shift right by one bit
    let mut carry = 0u8;
    for b in half.iter_mut() {
        let next = *b & 1;
        *b = (*b >> 1) | (carry << 7);
        carry = next;
    }
    if gt(&s, &half) {
        sub(&N, &s)
    } else {
        s
    }
}

fn der_int(out: &mut Vec<u8>, v: &[u8; 32]) {
    let start = v.iter().position(|&b| b != 0).unwrap_or(31);
    let digits = &v[start..];
    let pad = digits[0] & 0x80 != 0;
    out.push(0x02);
    out.push((digits.len() + pad as usize) as u8);
    if pad {
        out.push(0x00);
    }
    out.extend_from_slice(digits);
}

/// DER-encodes (r, s) and appends the SIGHASH_ALL byte, ready for the witness.
pub fn der_signature(r: &[u8; 32], s: &[u8; 32]) -> Vec<u8> {
    let s = normalize_s(*s);
    let mut body = Vec::new();
    der_int(&mut body, r);
    der_int(&mut body, &s);
    let mut out = vec![0x30, body.len() as u8];
    out.extend_from_slice(&body);
    out.push(SIGHASH_ALL as u8);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use bitcoin::consensus::deserialize;
    use bitcoin::hashes::Hash;
    use bitcoin::sighash::SighashCache;
    use bitcoin::{Amount, EcdsaSighashType, ScriptBuf, Transaction};

    fn sample(n_inputs: usize) -> (Tx, [u8; 20]) {
        let key_hash = hash160(&[2u8; 33]);
        let inputs = (0..n_inputs)
            .map(|i| Input { txid_le: [(i as u8) + 7; 32], vout: i as u32, value: 100_000 + 31 * i as u64 })
            .collect();
        let outputs = vec![
            Output { value: 40_000, script: p2wpkh_script(&[9u8; 20]) },
            Output { value: 55_321, script: p2wpkh_script(&key_hash) },
        ];
        (Tx { inputs, outputs }, key_hash)
    }

    #[test]
    fn sighash_matches_rust_bitcoin() {
        for n in 1..=3 {
            let (tx, key_hash) = sample(n);
            // Parse our own signed serialization with rust-bitcoin, then ask it for the sighash.
            let dummy: Vec<_> = (0..n).map(|_| (der_signature(&[1u8; 32], &[1u8; 32]), [2u8; 33])).collect();
            let parsed: Transaction = deserialize(&tx.serialize_signed(&dummy)).expect("valid tx");
            let script = ScriptBuf::from_bytes(p2wpkh_script(&key_hash));
            let mut cache = SighashCache::new(&parsed);
            for i in 0..n {
                let expected = cache
                    .p2wpkh_signature_hash(i, &script, Amount::from_sat(tx.inputs[i].value), EcdsaSighashType::All)
                    .unwrap();
                assert_eq!(tx.sighash(i, &key_hash), expected.to_byte_array(), "input {i} of {n}");
            }
            assert_eq!(parsed.compute_txid().to_byte_array(), tx.txid_le());
        }
    }

    #[test]
    fn wrong_input_value_changes_sighash() {
        let (mut tx, key_hash) = sample(2);
        let honest = tx.sighash(0, &key_hash);
        tx.inputs[0].value += 1;
        assert_ne!(honest, tx.sighash(0, &key_hash));
    }

    #[test]
    fn address_round_trip() {
        let h = hash160(&[3u8; 33]);
        let a = address("tb", &h);
        assert!(a.starts_with("tb1q"));
        assert_eq!(decode_p2wpkh("tb", &a).unwrap(), h);
        assert!(decode_p2wpkh("bc", &a).is_err());
        assert!(decode_p2wpkh("tb", "tb1qinvalid").is_err());
    }

    #[test]
    fn der_encoding_is_canonical() {
        // High bit set on r forces a 0x00 pad; a high s is flipped to low-s.
        let r = [0xffu8; 32];
        let mut high_s = N;
        high_s[31] -= 1; // N - 1, definitely > N/2
        let der = der_signature(&r, &high_s);
        let sig = bitcoin::secp256k1::ecdsa::Signature::from_der(&der[..der.len() - 1]).expect("strict DER");
        let mut again = sig;
        again.normalize_s();
        assert_eq!(sig, again, "signature must already be low-S");
        assert_eq!(der[0], 0x30);
        assert_eq!(*der.last().unwrap(), 1);
        assert_eq!(normalize_s(high_s)[31], 1); // N - (N - 1) = 1
    }
}
