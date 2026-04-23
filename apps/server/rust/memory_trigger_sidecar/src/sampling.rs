const FNV_OFFSET_BASIS_64: u64 = 0xcbf29ce484222325;
const FNV_PRIME_64: u64 = 0x100000001b3;
const SAMPLE_DIVISOR_64: f64 = 18446744073709551616.0;
const MISSING_PACK_ID_SENTINEL: &str = "__no_pack__";

pub fn build_trigger_rate_gate_seed(
    pack_id: Option<&str>,
    memory_id: &str,
    current_tick: &str,
    previous_trigger_count: i64,
) -> String {
    [
        "memory_trigger_rate_gate",
        pack_id.unwrap_or(MISSING_PACK_ID_SENTINEL),
        memory_id,
        current_tick,
        &previous_trigger_count.to_string(),
    ]
    .join("::")
}

pub fn fnv1a64(input: &str) -> u64 {
    let mut hash = FNV_OFFSET_BASIS_64;
    for byte in input.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(FNV_PRIME_64);
    }
    hash
}

pub fn compute_trigger_rate_sample(seed: &str) -> f64 {
    (fnv1a64(seed) as f64) / SAMPLE_DIVISOR_64
}

#[cfg(test)]
mod tests {
    use super::{build_trigger_rate_gate_seed, compute_trigger_rate_sample, fnv1a64};

    #[test]
    fn builds_stable_seed() {
        assert_eq!(
            build_trigger_rate_gate_seed(Some("pack-1"), "memory-1", "100", 2),
            "memory_trigger_rate_gate::pack-1::memory-1::100::2"
        );
        assert_eq!(
            build_trigger_rate_gate_seed(None, "memory-1", "100", 0),
            "memory_trigger_rate_gate::__no_pack__::memory-1::100::0"
        );
    }

    #[test]
    fn fnv1a64_is_stable() {
        assert_eq!(fnv1a64("memory_trigger_rate_gate::pack-1::memory-1::100::2"), 14442901213011553203);
    }

    #[test]
    fn sample_is_within_unit_interval() {
        let sample = compute_trigger_rate_sample("memory_trigger_rate_gate::pack-1::memory-1::100::2");
        assert!(sample >= 0.0);
        assert!(sample < 1.0);
    }
}
