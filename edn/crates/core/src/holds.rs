//! Whether a field can hold a value a cell's own formula gives (D52): the
//! check a typed value gets, `holds` in packages/core/src/validator.ts, with
//! the value encodings of packages/core/src/encoding.ts.

use crate::eval::Value;

/// What `holds` needs of a field: its type, and whether it's a relation to many rows.
#[derive(Clone, Debug, Default)]
pub struct Kind {
    pub ty: String,
    pub many: bool,
}

/// Whether a field of `kind` can hold `v`. An empty value always can. `None`: the core can't tell (a
/// GeoJSON field), and the host works the table out.
pub fn holds(kind: &Kind, v: &Value) -> bool {
    if v.is_empty() {
        return true;
    }
    if kind.many {
        return matches!(v, Value::List(items) if items.iter().all(|i| matches!(i, Value::Str(_))));
    }
    let text = |check: fn(&str) -> bool| matches!(v, Value::Str(s) if check(s));
    match kind.ty.as_str() {
        "string" => matches!(v, Value::Str(_)),
        "date" => text(is_date),
        "datetime" => text(is_date_time),
        "time" => text(is_time),
        "duration" => text(is_duration),
        // Any JSON value (D56): only a number JSON can't write is refused.
        "any" => !matches!(v, Value::Number(n) if !n.is_finite()),
        "number" => matches!(v, Value::Number(n) if n.is_finite()),
        "integer" | "year" => matches!(v, Value::Number(n) if n.fract() == 0.0 && n.abs() <= 9_007_199_254_740_991.0),
        "boolean" => matches!(v, Value::Bool(_)),
        "array" => matches!(v, Value::List(_)),
        // A formula never gives an object.
        "object" => false,
        "geopoint" => matches!(v, Value::List(items) if items.len() == 2
            && matches!((&items[0], &items[1]), (Value::Number(x), Value::Number(y)) if x.is_finite() && y.is_finite() && x.abs() <= 180.0 && y.abs() <= 90.0)),
        _ => true,
    }
}

/// Types whose check the core doesn't carry: a cell's formula in one is the host's.
pub fn checked_by_host(kind: &Kind) -> bool {
    !kind.many && kind.ty == "geojson"
}

fn digits(s: &[u8]) -> bool {
    !s.is_empty() && s.iter().all(u8::is_ascii_digit)
}

fn number(s: &[u8]) -> u32 {
    s.iter().fold(0, |n, d| n * 10 + u32::from(d - b'0'))
}

/// RFC 3339 full-date, and a real calendar day (`2026-02-30` is not).
pub fn is_date(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' || !digits(&b[..4]) || !digits(&b[5..7]) || !digits(&b[8..]) {
        return false;
    }
    let (y, m, d) = (number(&b[..4]), number(&b[5..7]), number(&b[8..]));
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let days = match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    (1..=days).contains(&d)
}

/// `HH:MM:SS`, an optional fraction; the length read, or None.
fn time_at(b: &[u8]) -> Option<usize> {
    if b.len() < 8 || b[2] != b':' || b[5] != b':' || !digits(&b[..2]) || !digits(&b[3..5]) || !digits(&b[6..8]) {
        return None;
    }
    if number(&b[..2]) > 23 || number(&b[3..5]) > 59 || number(&b[6..8]) > 60 {
        return None;
    }
    let mut at = 8;
    if b.get(at) == Some(&b'.') {
        let start = at + 1;
        at = start;
        while b.get(at).is_some_and(u8::is_ascii_digit) {
            at += 1;
        }
        if at == start {
            return None;
        }
    }
    Some(at)
}

/// RFC 3339 partial-time: `HH:MM:SS`, optional fraction, no offset.
pub fn is_time(s: &str) -> bool {
    time_at(s.as_bytes()) == Some(s.len())
}

/// RFC 3339 date-time; the offset is optional (none = floating).
pub fn is_date_time(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() < 11 || !(b[10] == b'T' || b[10] == b't') || !is_date(&s[..10]) {
        return false;
    }
    let Some(n) = time_at(&b[11..]) else { return false };
    let rest = &b[11 + n..];
    match rest {
        [] | [b'Z'] | [b'z'] => true,
        [sign, h1, h2, b':', m1, m2] if (*sign == b'+' || *sign == b'-') => {
            digits(&[*h1, *h2, *m1, *m2]) && number(&[*h1, *h2]) <= 23 && number(&[*m1, *m2]) <= 59
        }
        _ => false,
    }
}

/// ISO 8601 duration with at least one component (`P` and `PT` alone are not).
pub fn is_duration(s: &str) -> bool {
    let b = s.as_bytes();
    if b.first() != Some(&b'P') || s.ends_with('T') || !b.iter().any(u8::is_ascii_digit) {
        return false;
    }
    // Each part a number (`\d+([.,]\d+)?`) and its unit, the units in order: Y M W D, then T, H M S.
    let mut at = 1;
    let mut units: &[u8] = b"YMWD";
    let mut timed = false;
    while at < b.len() {
        if b[at] == b'T' {
            if timed {
                return false;
            }
            timed = true;
            units = b"HMS";
            at += 1;
            continue;
        }
        let start = at;
        while b.get(at).is_some_and(u8::is_ascii_digit) {
            at += 1;
        }
        if at == start {
            return false;
        }
        if matches!(b.get(at), Some(b'.' | b',')) {
            at += 1;
            let frac = at;
            while b.get(at).is_some_and(u8::is_ascii_digit) {
                at += 1;
            }
            if at == frac {
                return false;
            }
        }
        let Some(&unit) = b.get(at) else { return false };
        let Some(k) = units.iter().position(|u| *u == unit) else { return false };
        units = &units[k + 1..];
        at += 1;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodings_as_typescript_reads_them() {
        for (s, ok) in [("2026-02-28", true), ("2024-02-29", true), ("2026-02-29", false), ("2026-13-01", false), ("2026-1-01", false), ("0000-01-01", true)] {
            assert_eq!(is_date(s), ok, "{s}");
        }
        for (s, ok) in [("23:59:60", true), ("24:00:00", false), ("12:00:00.5", true), ("12:00:00.", false), ("12:00", false)] {
            assert_eq!(is_time(s), ok, "{s}");
        }
        for (s, ok) in [("2026-10-24T12:00:00Z", true), ("2026-10-24t12:00:00+01:00", true), ("2026-10-24T12:00:00", true), ("2026-10-24T12:00:00+24:00", false), ("2026-10-24 12:00:00", false)] {
            assert_eq!(is_date_time(s), ok, "{s}");
        }
        for (s, ok) in [("P1D", true), ("PT1H30M", true), ("P1.5Y", true), ("P", false), ("PT", false), ("P1DT", false), ("P1D1Y", false), ("P1H", false), ("PT1D", false)] {
            assert_eq!(is_duration(s), ok, "{s}");
        }
    }
}
