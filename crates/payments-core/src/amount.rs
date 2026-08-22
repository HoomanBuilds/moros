use core::{fmt, str::FromStr};

use crate::{Error, Result, USDC_DECIMALS};

pub const MAX_ATOMIC_USDC: i128 = (1_i128 << 120) - 1;
const SCALE: i128 = 10_i128.pow(USDC_DECIMALS);

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct AtomicUsdc(i128);

impl AtomicUsdc {
    pub fn new(value: i128) -> Result<Self> {
        if value <= 0 {
            return Err(Error::InvalidAmount);
        }
        if value > MAX_ATOMIC_USDC {
            return Err(Error::AmountOverflow);
        }
        Ok(Self(value))
    }

    pub const fn atomic(self) -> i128 {
        self.0
    }
}

impl TryFrom<i128> for AtomicUsdc {
    type Error = Error;

    fn try_from(value: i128) -> Result<Self> {
        Self::new(value)
    }
}

impl FromStr for AtomicUsdc {
    type Err = Error;

    fn from_str(value: &str) -> Result<Self> {
        if value.is_empty()
            || value.starts_with('+')
            || value.starts_with('-')
            || value.trim() != value
        {
            return Err(Error::InvalidAmount);
        }

        let mut parts = value.split('.');
        let whole = parts.next().ok_or(Error::InvalidAmount)?;
        let fraction = parts.next();
        if parts.next().is_some()
            || whole.is_empty()
            || !whole.bytes().all(|byte| byte.is_ascii_digit())
            || (whole.len() > 1 && whole.starts_with('0'))
        {
            return Err(Error::InvalidAmount);
        }

        let whole = whole.parse::<i128>().map_err(|_| Error::AmountOverflow)?;
        let whole_atomic = whole.checked_mul(SCALE).ok_or(Error::AmountOverflow)?;

        let fractional_atomic = match fraction {
            None => 0,
            Some(fraction) => {
                if fraction.is_empty()
                    || fraction.len() > USDC_DECIMALS as usize
                    || !fraction.bytes().all(|byte| byte.is_ascii_digit())
                {
                    return Err(Error::InvalidAmount);
                }
                let parsed = fraction
                    .parse::<i128>()
                    .map_err(|_| Error::AmountOverflow)?;
                parsed
                    .checked_mul(10_i128.pow(USDC_DECIMALS - fraction.len() as u32))
                    .ok_or(Error::AmountOverflow)?
            }
        };

        let atomic = whole_atomic
            .checked_add(fractional_atomic)
            .ok_or(Error::AmountOverflow)?;
        Self::new(atomic)
    }
}

impl fmt::Display for AtomicUsdc {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let whole = self.0 / SCALE;
        let fraction = self.0 % SCALE;
        if fraction == 0 {
            return write!(formatter, "{whole}");
        }

        let mut fraction = format!("{fraction:07}");
        while fraction.ends_with('0') {
            fraction.pop();
        }
        write!(formatter, "{whole}.{fraction}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_formats_atomic_usdc() {
        let cases = [
            ("0.0000001", 1),
            ("0.1", 1_000_000),
            ("1", 10_000_000),
            ("1.2300000", 12_300_000),
            ("100.0000001", 1_000_000_001),
        ];

        for (display, atomic) in cases {
            let parsed: AtomicUsdc = display.parse().unwrap();
            assert_eq!(parsed.atomic(), atomic);
            assert_eq!(parsed.to_string().parse::<AtomicUsdc>().unwrap(), parsed);
        }
    }

    #[test]
    fn rejects_invalid_amounts() {
        for value in [
            "",
            "0",
            "0.0000000",
            "-1",
            "+1",
            " 1",
            "1 ",
            ".1",
            "1.",
            "01",
            "1.00000001",
            "1,000",
            "1e2",
            "1.2.3",
        ] {
            assert!(value.parse::<AtomicUsdc>().is_err(), "accepted {value}");
        }
    }

    #[test]
    fn rejects_overflow() {
        assert_eq!(
            "170141183460469231731687303715884105728".parse::<AtomicUsdc>(),
            Err(Error::AmountOverflow)
        );
        assert_eq!(
            AtomicUsdc::new(MAX_ATOMIC_USDC).unwrap().atomic(),
            MAX_ATOMIC_USDC
        );
        assert_eq!(
            AtomicUsdc::new(MAX_ATOMIC_USDC + 1),
            Err(Error::AmountOverflow)
        );
    }
}
