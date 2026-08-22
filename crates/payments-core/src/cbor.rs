use crate::{Error, Result};

pub(crate) struct Encoder {
    bytes: Vec<u8>,
}

impl Encoder {
    pub(crate) fn new() -> Self {
        Self { bytes: Vec::new() }
    }

    pub(crate) fn map(&mut self, length: u64) {
        self.major(5, length);
    }

    pub(crate) fn unsigned(&mut self, value: u64) {
        self.major(0, value);
    }

    pub(crate) fn bytes(&mut self, value: &[u8]) {
        self.major(2, value.len() as u64);
        self.bytes.extend_from_slice(value);
    }

    pub(crate) fn text(&mut self, value: &str) {
        self.major(3, value.len() as u64);
        self.bytes.extend_from_slice(value.as_bytes());
    }

    pub(crate) fn null(&mut self) {
        self.bytes.push(0xf6);
    }

    pub(crate) fn finish(self) -> Vec<u8> {
        self.bytes
    }

    fn major(&mut self, major: u8, value: u64) {
        let prefix = major << 5;
        if value <= 23 {
            self.bytes.push(prefix | value as u8);
        } else if value <= u8::MAX as u64 {
            self.bytes.push(prefix | 24);
            self.bytes.push(value as u8);
        } else if value <= u16::MAX as u64 {
            self.bytes.push(prefix | 25);
            self.bytes.extend_from_slice(&(value as u16).to_be_bytes());
        } else if value <= u32::MAX as u64 {
            self.bytes.push(prefix | 26);
            self.bytes.extend_from_slice(&(value as u32).to_be_bytes());
        } else {
            self.bytes.push(prefix | 27);
            self.bytes.extend_from_slice(&value.to_be_bytes());
        }
    }
}

pub(crate) struct Decoder<'a> {
    bytes: &'a [u8],
    cursor: usize,
}

impl<'a> Decoder<'a> {
    pub(crate) fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, cursor: 0 }
    }

    pub(crate) fn map(&mut self) -> Result<u64> {
        self.major(5)
    }

    pub(crate) fn unsigned(&mut self) -> Result<u64> {
        self.major(0)
    }

    pub(crate) fn bytes(&mut self, maximum: usize) -> Result<&'a [u8]> {
        let length = self.major(2)? as usize;
        if length > maximum {
            return Err(Error::RequestTooLarge);
        }
        self.take(length)
    }

    pub(crate) fn text(&mut self, maximum: usize) -> Result<&'a str> {
        let length = self.major(3)? as usize;
        if length > maximum {
            return Err(Error::MerchantLabelTooLong);
        }
        core::str::from_utf8(self.take(length)?).map_err(|_| Error::InvalidRequestEncoding)
    }

    pub(crate) fn is_null(&self) -> bool {
        self.bytes.get(self.cursor) == Some(&0xf6)
    }

    pub(crate) fn null(&mut self) -> Result<()> {
        if self.take(1)? != [0xf6] {
            return Err(Error::InvalidRequestEncoding);
        }
        Ok(())
    }

    pub(crate) fn finish(self) -> Result<()> {
        if self.cursor != self.bytes.len() {
            return Err(Error::InvalidRequestEncoding);
        }
        Ok(())
    }

    fn major(&mut self, expected_major: u8) -> Result<u64> {
        let first = *self.take(1)?.first().ok_or(Error::InvalidRequestEncoding)?;
        if first >> 5 != expected_major {
            return Err(Error::InvalidRequestEncoding);
        }
        let additional = first & 0x1f;
        match additional {
            0..=23 => Ok(u64::from(additional)),
            24 => {
                let value = u64::from(self.take(1)?[0]);
                if value < 24 {
                    return Err(Error::InvalidRequestEncoding);
                }
                Ok(value)
            }
            25 => {
                let value = u64::from(u16::from_be_bytes(
                    self.take(2)?.try_into().expect("checked CBOR length"),
                ));
                if value <= u8::MAX as u64 {
                    return Err(Error::InvalidRequestEncoding);
                }
                Ok(value)
            }
            26 => {
                let value = u64::from(u32::from_be_bytes(
                    self.take(4)?.try_into().expect("checked CBOR length"),
                ));
                if value <= u16::MAX as u64 {
                    return Err(Error::InvalidRequestEncoding);
                }
                Ok(value)
            }
            27 => {
                let value =
                    u64::from_be_bytes(self.take(8)?.try_into().expect("checked CBOR length"));
                if value <= u32::MAX as u64 {
                    return Err(Error::InvalidRequestEncoding);
                }
                Ok(value)
            }
            _ => Err(Error::InvalidRequestEncoding),
        }
    }

    fn take(&mut self, length: usize) -> Result<&'a [u8]> {
        let end = self
            .cursor
            .checked_add(length)
            .ok_or(Error::InvalidRequestEncoding)?;
        let output = self
            .bytes
            .get(self.cursor..end)
            .ok_or(Error::InvalidRequestEncoding)?;
        self.cursor = end;
        Ok(output)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_integer_boundaries_round_trip() {
        for value in [0, 23, 24, 255, 256, 65_535, 65_536, u32::MAX as u64 + 1] {
            let mut encoder = Encoder::new();
            encoder.unsigned(value);
            let encoded = encoder.finish();
            let mut decoder = Decoder::new(&encoded);
            assert_eq!(decoder.unsigned().unwrap(), value);
            decoder.finish().unwrap();
        }
    }

    #[test]
    fn rejects_noncanonical_and_indefinite_encodings() {
        for encoded in [&[0x18, 0x17][..], &[0x19, 0x00, 0xff], &[0x1f]] {
            assert!(Decoder::new(encoded).unsigned().is_err());
        }
    }
}
