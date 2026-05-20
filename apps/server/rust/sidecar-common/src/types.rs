use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Tick(u64);

impl Tick {
    pub const ZERO: Tick = Tick::new(0);

    pub const fn new(value: u64) -> Self {
        Tick(value)
    }

    pub fn parse(s: &str) -> Result<Self, TickParseError> {
        s.parse::<u64>().map(Tick).map_err(|_| TickParseError { raw: s.to_string() })
    }

    pub fn as_u64(self) -> u64 {
        self.0
    }

    pub fn checked_add(self, rhs: u64) -> Option<Self> {
        self.0.checked_add(rhs).map(Tick)
    }

    pub fn saturating_sub(self, rhs: u64) -> u64 {
        self.0.saturating_sub(rhs)
    }
}

impl fmt::Display for Tick {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl Serialize for Tick {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.0.to_string())
    }
}

impl<'de> Deserialize<'de> for Tick {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let s = String::deserialize(d)?;
        s.parse::<u64>().map(Tick).map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, thiserror::Error)]
#[error("invalid tick: {raw}")]
pub struct TickParseError {
    pub raw: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json;

    #[test]
    fn tick_serializes_as_string() {
        let tick = Tick::new(42);
        let json = serde_json::to_string(&tick).unwrap();
        assert_eq!(json, "\"42\"");
    }

    #[test]
    fn tick_deserializes_from_string() {
        let tick: Tick = serde_json::from_str("\"42\"").unwrap();
        assert_eq!(tick, Tick::new(42));
    }

    #[test]
    fn tick_rejects_non_numeric() {
        let result: Result<Tick, _> = serde_json::from_str("\"abc\"");
        assert!(result.is_err());
    }

    #[test]
    fn tick_parse_valid() {
        assert_eq!(Tick::parse("100").unwrap(), Tick::new(100));
    }

    #[test]
    fn tick_parse_invalid() {
        assert!(Tick::parse("abc").is_err());
    }

    #[test]
    fn tick_checked_add() {
        assert_eq!(Tick::new(10).checked_add(5), Some(Tick::new(15)));
        assert_eq!(Tick::new(u64::MAX).checked_add(1), None);
    }

    #[test]
    fn tick_saturating_sub() {
        assert_eq!(Tick::new(10).saturating_sub(3), 7);
        assert_eq!(Tick::new(3).saturating_sub(10), 0);
    }
}
