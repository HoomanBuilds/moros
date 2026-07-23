//! LMSR fixed-point math (i128, value * 2^32).

pub const FRAC: u32 = 32;
pub const SCALE: i128 = 1 << FRAC; // 2^32
const LN2: i128 = 2977044472; // ln(2) * 2^32

pub fn initial_loss_bound(b: i128) -> i128 {
    (b * LN2) >> FRAC
}

#[inline]
fn fmul(a: i128, b: i128) -> i128 {
    (a * b) >> FRAC
}
#[inline]
fn fdiv(a: i128, b: i128) -> i128 {
    (a << FRAC) / b
}

/// e^x in fixed-point. x may be negative. Range-reduce by ln2, Taylor remainder.
fn fexp(x: i128) -> i128 {
    let mut k = x / LN2;
    let mut r = x - k * LN2;
    if r > LN2 / 2 {
        k += 1;
        r -= LN2;
    }
    if r < -LN2 / 2 {
        k -= 1;
        r += LN2;
    }
    if k <= -127 {
        return 0;
    }
    if k >= 127 {
        return i128::MAX;
    }
    let mut term = SCALE;
    let mut sum = SCALE;
    let mut n: i128 = 1;
    while n <= 12 {
        term = fmul(term, r) / n;
        sum += term;
        n += 1;
    }
    if k >= 0 {
        sum.checked_shl(k as u32).unwrap_or(i128::MAX)
    } else {
        sum >> ((-k) as u32)
    }
}

/// ln(x) in fixed-point for x > 0. Reduce x = 2^k * m (m in [1,2)); ln = k*ln2 + ln(m).
fn fln(x: i128) -> i128 {
    let mut m = x;
    let mut k: i128 = 0;
    while m >= 2 * SCALE {
        m >>= 1;
        k += 1;
    }
    while m < SCALE {
        m <<= 1;
        k -= 1;
    }
    let u = fdiv(m - SCALE, m + SCALE);
    let u2 = fmul(u, u);
    let mut num = u;
    let mut sum = u;
    let mut d: i128 = 3;
    while d <= 13 {
        num = fmul(num, u2);
        sum += num / d;
        d += 2;
    }
    (sum << 1) + k * LN2
}

/// LMSR cost function value. q_yes, q_no, b are fixed-point (value * 2^32).
pub fn cost(q_yes: i128, q_no: i128, b: i128) -> i128 {
    let a = fdiv(q_yes, b);
    let c = fdiv(q_no, b);
    let m = if a > c { a } else { c };
    let s = fexp(a - m) + fexp(c - m); // in [1,2] * SCALE
    fmul(b, m) + fmul(b, fln(s)) // b*(m + ln s) = max_q + b*ln(Σ exp(q_i/b - max))
}

/// Instantaneous YES price = exp(q_yes/b) / (exp(q_yes/b)+exp(q_no/b)), fixed-point.
pub fn price_yes(q_yes: i128, q_no: i128, b: i128) -> i128 {
    let a = fdiv(q_yes, b);
    let c = fdiv(q_no, b);
    let m = if a > c { a } else { c };
    let ea = fexp(a - m);
    let ec = fexp(c - m);
    fdiv(ea, ea + ec)
}

fn softplus(value: i128) -> i128 {
    let maximum = if value > 0 { value } else { 0 };
    maximum + fln(fexp(value - maximum) + fexp(-maximum))
}

pub fn average_yes_price(
    q_yes: i128,
    q_no: i128,
    delta_yes: i128,
    delta_no: i128,
    b: i128,
) -> i128 {
    let start = fdiv(q_yes - q_no, b);
    let delta = fdiv(delta_yes - delta_no, b);
    if delta == 0 {
        return price_yes(q_yes, q_no, b);
    }
    let price = fdiv(softplus(start + delta) - softplus(start), delta);
    price.clamp(0, SCALE)
}

pub fn multiply_fixed(a: i128, b: i128) -> i128 {
    fmul(a, b)
}
