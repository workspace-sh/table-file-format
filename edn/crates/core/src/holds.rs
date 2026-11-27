//! Whether a field can hold a value a cell's own formula gives (D52): the
//! check a typed value gets, `holds` in packages/core/src/validator.ts, with
//! the value encodings of `crate::encoding`.

use crate::encoding::{is_geojson_text, is_lon_lat};
use crate::eval::Value;

/// The encodings `holds` reads, where they were first defined.
pub use crate::encoding::{is_date, is_date_time, is_duration, is_time};

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
        "object" => matches!(v, Value::Object(_)),
        // GeoJSON (SPEC "Value encodings"): an object with a `type`, or text that reads as one, as `.table`'s isGeoJSON.
        "geojson" => match v {
            Value::Object(json) | Value::Str(json) => is_geojson_text(json),
            _ => false,
        },
        "geopoint" => matches!(v, Value::List(items) if items.len() == 2
            && matches!((&items[0], &items[1]), (Value::Number(x), Value::Number(y)) if is_lon_lat(*x, *y))),
        _ => true,
    }
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
