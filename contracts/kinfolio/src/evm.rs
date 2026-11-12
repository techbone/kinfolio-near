//! Just enough EVM for one transaction shape: an EIP-1559 call to `KinfolioSplitter.split`.
//!
//! Hand-rolled (RLP, ABI, EIP-1559) to keep the wasm small; the test below checks byte-for-byte
//! against a transaction produced by Foundry's `cast mktx`.

use near_sdk::env;

/// `KinfolioSplitter.split(address[],uint16[])`
const SPLIT_SIG: &[u8] = b"split(address[],uint16[])";
const EIP1559_TYPE: u8 = 0x02;

pub struct Tx {
    pub chain_id: u64,
    pub nonce: u64,
    pub max_priority_fee_per_gas: u128,
    pub max_fee_per_gas: u128,
    pub gas_limit: u64,
    pub to: [u8; 20],
    pub value: u128,
    pub data: Vec<u8>,
}

pub fn parse_address(s: &str) -> Result<[u8; 20], String> {
    let hex_part = s.strip_prefix("0x").ok_or("evm address must start with 0x")?;
    let mut out = [0u8; 20];
    hex::decode_to_slice(hex_part, &mut out).map_err(|_| "evm address must be 0x followed by 40 hex characters".to_string())?;
    Ok(out)
}

/// ABI-encodes `split(to, bps)`.
pub fn split_calldata(to: &[[u8; 20]], bps: &[u16]) -> Vec<u8> {
    let n = to.len();
    let word = |v: u64| {
        let mut w = [0u8; 32];
        w[24..].copy_from_slice(&v.to_be_bytes());
        w
    };
    let mut out = env::keccak256(SPLIT_SIG)[..4].to_vec();
    out.extend_from_slice(&word(0x40)); // offset of `to`
    out.extend_from_slice(&word(0x40 + 32 * (1 + n as u64))); // offset of `bps`
    out.extend_from_slice(&word(n as u64));
    for a in to {
        let mut w = [0u8; 32];
        w[12..].copy_from_slice(a);
        out.extend_from_slice(&w);
    }
    out.extend_from_slice(&word(n as u64));
    for b in bps {
        out.extend_from_slice(&word(*b as u64));
    }
    out
}

impl Tx {
    fn fields(&self) -> Vec<Vec<u8>> {
        vec![
            rlp_uint(self.chain_id as u128),
            rlp_uint(self.nonce as u128),
            rlp_uint(self.max_priority_fee_per_gas),
            rlp_uint(self.max_fee_per_gas),
            rlp_uint(self.gas_limit as u128),
            rlp_bytes(&self.to),
            rlp_uint(self.value),
            rlp_bytes(&self.data),
            rlp_list(&[]), // empty access list
        ]
    }

    /// The hash the owner key signs: keccak256(0x02 || rlp(fields)).
    pub fn sighash(&self) -> [u8; 32] {
        let mut payload = vec![EIP1559_TYPE];
        payload.extend(rlp_list(&self.fields()));
        env::keccak256_array(&payload)
    }

    /// 0x02 || rlp(fields ++ [y_parity, r, s]); `s` must already be low-S.
    pub fn serialize_signed(&self, y_parity: u8, r: &[u8; 32], s: &[u8; 32]) -> Vec<u8> {
        let mut f = self.fields();
        f.push(rlp_uint(y_parity as u128));
        f.push(rlp_bytes(strip_zeros(r)));
        f.push(rlp_bytes(strip_zeros(s)));
        let mut out = vec![EIP1559_TYPE];
        out.extend(rlp_list(&f));
        out
    }
}

/// The transaction hash explorers show: keccak256 of the signed bytes.
pub fn tx_hash(signed: &[u8]) -> String {
    format!("0x{}", hex::encode(env::keccak256_array(signed)))
}

fn strip_zeros(v: &[u8]) -> &[u8] {
    let start = v.iter().position(|&b| b != 0).unwrap_or(v.len());
    &v[start..]
}

fn rlp_uint(v: u128) -> Vec<u8> {
    rlp_bytes(strip_zeros(&v.to_be_bytes()))
}

fn rlp_len_prefix(len: usize, short: u8, long: u8) -> Vec<u8> {
    if len <= 55 {
        vec![short + len as u8]
    } else {
        let len_bytes = strip_zeros(&(len as u64).to_be_bytes()).to_vec();
        let mut out = vec![long + len_bytes.len() as u8];
        out.extend(len_bytes);
        out
    }
}

fn rlp_bytes(b: &[u8]) -> Vec<u8> {
    if b.len() == 1 && b[0] < 0x80 {
        return b.to_vec();
    }
    let mut out = rlp_len_prefix(b.len(), 0x80, 0xb7);
    out.extend_from_slice(b);
    out
}

fn rlp_list(items: &[Vec<u8>]) -> Vec<u8> {
    let body: Vec<u8> = items.concat();
    let mut out = rlp_len_prefix(body.len(), 0xc0, 0xf7);
    out.extend(body);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn h(s: &str) -> [u8; 32] {
        let mut out = [0u8; 32];
        hex::decode_to_slice(s, &mut out).unwrap();
        out
    }

    /// Same fields as:
    /// `cast mktx --chain 84532 --nonce 7 --gas-limit 120000 --priority-gas-price 1000000
    ///  --gas-price 2000000 --value 123456789000000 0x1111…1111 "split(address[],uint16[])"
    ///  "[0x2222…2222,0x3333…3333]" "[6000,4000]"`
    fn reference() -> Tx {
        Tx {
            chain_id: 84532,
            nonce: 7,
            max_priority_fee_per_gas: 1_000_000,
            max_fee_per_gas: 2_000_000,
            gas_limit: 120_000,
            to: [0x11; 20],
            value: 123_456_789_000_000,
            data: split_calldata(&[[0x22; 20], [0x33; 20]], &[6_000, 4_000]),
        }
    }

    const CAST_SIGNED: &str = "02f9017883014a3407830f4240831e84808301d4c0941111111111111111111111111111111111111111867048860daf40b9010433ea7854000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000200000000000000000000000022222222222222222222222222222222222222220000000000000000000000003333333333333333333333333333333333333333000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000017700000000000000000000000000000000000000000000000000000000000000fa0c001a07c490cc93238d767e2c52b6c32ab88a3d297a86d4ff2acd55dac92f727ee8837a0393fa9ed08bb9ae0cfd17399d57621e7965eb966d4dc4d94ea54a254241a7b1d";

    #[test]
    fn signed_tx_matches_foundry_byte_for_byte() {
        let r = h("7c490cc93238d767e2c52b6c32ab88a3d297a86d4ff2acd55dac92f727ee8837");
        let s = h("393fa9ed08bb9ae0cfd17399d57621e7965eb966d4dc4d94ea54a254241a7b1d");
        assert_eq!(hex::encode(reference().serialize_signed(1, &r, &s)), CAST_SIGNED);
    }

    #[test]
    fn sighash_recovers_to_the_signing_key() {
        use bitcoin::secp256k1::ecdsa::{RecoverableSignature, RecoveryId};
        use bitcoin::secp256k1::{Message, Secp256k1};
        let mut rs = [0u8; 64];
        rs[..32].copy_from_slice(&h("7c490cc93238d767e2c52b6c32ab88a3d297a86d4ff2acd55dac92f727ee8837"));
        rs[32..].copy_from_slice(&h("393fa9ed08bb9ae0cfd17399d57621e7965eb966d4dc4d94ea54a254241a7b1d"));
        let sig = RecoverableSignature::from_compact(&rs, RecoveryId::from_i32(1).unwrap()).unwrap();
        let pk = Secp256k1::new().recover_ecdsa(&Message::from_digest(reference().sighash()), &sig).unwrap();
        let addr = &env::keccak256(&pk.serialize_uncompressed()[1..])[12..];
        assert_eq!(hex::encode(addr), "2c7536e3605d9c16a7a3d7b1898e529396a65c23");
    }

    #[test]
    fn rlp_edge_cases() {
        assert_eq!(rlp_uint(0), vec![0x80]);
        assert_eq!(rlp_uint(0x7f), vec![0x7f]);
        assert_eq!(rlp_uint(0x80), vec![0x81, 0x80]);
        assert_eq!(rlp_bytes(&[0u8; 56])[..2], [0xb8, 56]);
    }
}
