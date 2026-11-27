//! Value encodings: one JSON spelling per field type (SPEC section 2 "Value
//! encodings", DECISIONS D30), as `.table`'s TypeScript `encoding` module
//! gives them (it calls these). Each check reads the text's bytes once, with
//! no regular expressions, so the engine carries no regex engine.

use serde_json::Value;

fn all_digits(b: &[u8]) -> bool {
    !b.is_empty() && b.iter().all(u8::is_ascii_digit)
}

fn number(b: &[u8]) -> u32 {
    b.iter().fold(0, |n, d| n * 10 + u32::from(d - b'0'))
}

/// `\d{4}-\d{2}-\d{2}`, as year, month and day, not yet checked as a day.
fn date_parts(b: &[u8]) -> Option<(u32, u32, u32)> {
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' || !all_digits(&b[0..4]) || !all_digits(&b[5..7]) || !all_digits(&b[8..10]) {
        return None;
    }
    Some((number(&b[0..4]), number(&b[5..7]), number(&b[8..10])))
}

fn leap(y: u32) -> bool {
    y.is_multiple_of(4) && (!y.is_multiple_of(100) || y.is_multiple_of(400))
}

/// A real day of the proleptic Gregorian calendar, years 0000 to 9999.
fn real_day(y: u32, m: u32, d: u32) -> bool {
    let days = match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap(y) => 29,
        2 => 28,
        _ => return false,
    };
    (1..=days).contains(&d)
}

/// `([01]\d|2[0-3]):[0-5]\d`, the hours and minutes.
fn hours_minutes(b: &[u8]) -> Option<(u32, u32)> {
    if b.len() < 5 || b[2] != b':' {
        return None;
    }
    let hour = matches!((b[0], b[1]), (b'0' | b'1', b'0'..=b'9') | (b'2', b'0'..=b'3'));
    let minute = matches!((b[3], b[4]), (b'0'..=b'5', b'0'..=b'9'));
    (hour && minute).then(|| (number(&b[0..2]), number(&b[3..5])))
}

/// A time of day as read: hours, minutes, seconds, and the fraction's digits.
struct Clock<'a> {
    hours: u32,
    minutes: u32,
    seconds: u32,
    fraction: &'a [u8],
}

/// RFC 3339 partial-time at the start of `b`, `HH:MM:SS` with an optional
/// fraction, and how many bytes it took.
fn partial_time(b: &[u8]) -> Option<(Clock<'_>, usize)> {
    let (hours, minutes) = hours_minutes(b)?;
    if b.len() < 8 || b[5] != b':' || !matches!((b[6], b[7]), (b'0'..=b'5', b'0'..=b'9') | (b'6', b'0')) {
        return None;
    }
    let mut end = 8;
    let mut fraction: &[u8] = &[];
    if b.get(8) == Some(&b'.') {
        let digits = b[9..].iter().take_while(|c| c.is_ascii_digit()).count();
        if digits > 0 {
            fraction = &b[9..9 + digits];
            end = 9 + digits;
        }
    }
    Some((Clock { hours, minutes, seconds: number(&b[6..8]), fraction }, end))
}

/// `Z|z|[+-]([01]\d|2[0-3]):[0-5]\d`, as minutes east of UTC.
fn offset(b: &[u8]) -> Option<i64> {
    match b {
        [b'Z' | b'z'] => Some(0),
        [sign @ (b'+' | b'-'), rest @ ..] if rest.len() == 5 => {
            let (h, m) = hours_minutes(rest)?;
            let minutes = i64::from(h * 60 + m);
            Some(if *sign == b'-' { -minutes } else { minutes })
        }
        _ => None,
    }
}

/// A date-time as read: its day (year, month, day), its time, and its offset
/// in minutes (None: floating).
struct DateTime<'a> {
    day: (u32, u32, u32),
    clock: Clock<'a>,
    zone: Option<i64>,
}

fn date_time(value: &str) -> Option<DateTime<'_>> {
    let b = value.as_bytes();
    if b.len() < 19 || !matches!(b[10], b'T' | b't') {
        return None;
    }
    let (y, m, d) = date_parts(&b[0..10])?;
    if !real_day(y, m, d) {
        return None;
    }
    let (clock, took) = partial_time(&b[11..])?;
    let rest = &b[11 + took..];
    let zone = if rest.is_empty() { None } else { Some(offset(rest)?) };
    Some(DateTime { day: (y, m, d), clock, zone })
}

/// RFC 3339 full-date, and a real calendar day (`2026-02-30` is not).
pub fn is_date(value: &str) -> bool {
    date_parts(value.as_bytes()).is_some_and(|(y, m, d)| real_day(y, m, d))
}

/// RFC 3339 partial-time: `HH:MM:SS`, optional fraction, no offset.
pub fn is_time(value: &str) -> bool {
    partial_time(value.as_bytes()).is_some_and(|(_, took)| took == value.len())
}

/// RFC 3339 date-time; the offset is optional (none = floating).
pub fn is_date_time(value: &str) -> bool {
    date_time(value).is_some()
}

/// `\d+([.,]\d+)?` followed by `designator`, at the start of `b`: how many bytes it took.
fn component(b: &[u8], designator: u8) -> Option<usize> {
    let whole = b.iter().take_while(|c| c.is_ascii_digit()).count();
    if whole == 0 {
        return None;
    }
    let mut end = whole;
    if matches!(b.get(end), Some(b'.' | b',')) {
        let part = b[end + 1..].iter().take_while(|c| c.is_ascii_digit()).count();
        if part > 0 {
            end += 1 + part;
        }
    }
    (b.get(end) == Some(&designator)).then_some(end + 1)
}

/// ISO 8601 duration with at least one component (`P` and `PT` alone are not).
pub fn is_duration(value: &str) -> bool {
    let b = value.as_bytes();
    let Some(mut rest) = b.strip_prefix(b"P") else { return false };
    let mut any = false;
    let mut take = |rest: &mut &[u8], designators: &[u8]| {
        for &d in designators {
            if let Some(took) = component(rest, d) {
                *rest = &rest[took..];
                any = true;
            }
        }
    };
    take(&mut rest, b"YMWD");
    if let Some(time) = rest.strip_prefix(b"T") {
        rest = time;
        if rest.is_empty() {
            return false;
        }
        take(&mut rest, b"HMS");
    }
    rest.is_empty() && any
}

/// A year and month, `YYYY-MM` (SPEC section 2).
pub fn is_year_month(value: &str) -> bool {
    let b = value.as_bytes();
    b.len() == 7 && all_digits(&b[0..4]) && b[4] == b'-' && matches!((b[5], b[6]), (b'0', b'1'..=b'9') | (b'1', b'0'..=b'2'))
}

/// Days from 1970-01-01 to the given proleptic Gregorian day.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// The instant a datetime names, in milliseconds since 1970 UTC, for
/// comparison. A floating value (no offset) compares as if it were UTC. A
/// fraction past milliseconds is cut, not rounded, and a leap second (`:60`)
/// names no instant, as JavaScript's `Date.parse` reads them. NaN when the
/// value is not a datetime.
pub fn instant_of(value: &str) -> f64 {
    let Some(DateTime { day: (y, m, d), clock, zone }) = date_time(value) else { return f64::NAN };
    if clock.seconds == 60 {
        return f64::NAN;
    }
    let ms = clock.fraction.iter().chain(b"000").take(3).fold(0, |n, c| n * 10 + i64::from(c - b'0'));
    let days = days_from_civil(i64::from(y), i64::from(m), i64::from(d));
    let minutes = i64::from(clock.hours * 60 + clock.minutes) - zone.unwrap_or(0);
    ((days * 1440 + minutes) * 60_000 + i64::from(clock.seconds) * 1000 + ms) as f64
}

/// A longitude and latitude within WGS 84's ranges.
pub fn is_lon_lat(lon: f64, lat: f64) -> bool {
    lon.is_finite() && lat.is_finite() && lon.abs() <= 180.0 && lat.abs() <= 90.0
}

/// `[longitude, latitude]`, WGS 84 ranges.
pub fn is_geopoint(value: &Value) -> bool {
    match value.as_array().map(Vec::as_slice) {
        Some([Value::Number(lon), Value::Number(lat)]) => matches!((lon.as_f64(), lat.as_f64()), (Some(x), Some(y)) if is_lon_lat(x, y)),
        _ => false,
    }
}

/// A GeoJSON object: an object with a string `type`. Earlier reference
/// readers stored GeoJSON as a string of its text; that form is still read,
/// and must parse to the same.
pub fn is_geojson(value: &Value) -> bool {
    match value {
        Value::String(text) => is_geojson_text(text),
        Value::Object(o) => matches!(o.get("type"), Some(Value::String(_))),
        _ => false,
    }
}

/// JSON text that reads as GeoJSON (see `is_geojson`).
pub fn is_geojson_text(json: &str) -> bool {
    serde_json::from_str::<Value>(json).is_ok_and(|v| is_geojson(&v))
}

/// Complete a `time` or `datetime` that omits seconds (what an HTML `time` /
/// `datetime-local` input gives back: `"09:30"`, `"2026-04-01T09:30"`) to
/// the one spelling the format stores (`"09:30:00"`). Anything else is
/// returned unchanged, including a value that isn't a time at all, so
/// validation still reports it.
pub fn complete_seconds(kind: &str, raw: &str) -> Option<String> {
    let b = raw.as_bytes();
    let short = match kind {
        "time" => b.len() == 5 && hours_minutes(b).is_some(),
        "datetime" => b.len() == 16 && date_parts(&b[0..10]).is_some() && matches!(b[10], b'T' | b't') && hours_minutes(&b[11..]).is_some(),
        _ => false,
    };
    short.then(|| format!("{raw}:00"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn dates_are_real_days_in_every_year_from_0000() {
        for d in ["2026-04-01", "0000-01-01", "0025-12-10", "0099-02-28", "2024-02-29", "2000-02-29"] {
            assert!(is_date(d), "{d}");
        }
        for d in ["01/04/2026", "2026-02-30", "2026-04-01T09:30:00Z", "0025-02-29", "0100-02-29", "2023-02-29", "2026-13-01", "2026-00-10", "2026-04-00", "2026-4-01", "２026-04-01", "2026-04-01\n"] {
            assert!(!is_date(d), "{d}");
        }
    }

    #[test]
    fn times_and_datetimes_have_one_spelling() {
        for t in ["09:30:00", "09:30:00.250", "23:59:60", "00:00:00.1"] {
            assert!(is_time(t), "{t}");
        }
        for t in ["9:30", "09:30", "09:30:00Z", "24:00:00", "09:60:00", "09:30:61", "09:30:00.", "09:30:00.5x"] {
            assert!(!is_time(t), "{t}");
        }
        for t in ["2026-04-01T09:30:00Z", "2026-04-01T11:30:00+02:00", "2026-04-01T09:30:00", "2026-04-01t09:30:00z", "0025-12-10T09:00:00Z", "2026-04-01T09:30:00.5-23:59"] {
            assert!(is_date_time(t), "{t}");
        }
        for t in ["2026-04-01 09:30:00", "2026-04-01", "2026-02-30T09:30:00Z", "2026-04-01T09:30:00+24:00", "2026-04-01T09:30:00+0200", "2026-04-01T09:30:00ZZ", "2026-04-01T09:30"] {
            assert!(!is_date_time(t), "{t}");
        }
    }

    #[test]
    fn durations_need_one_component() {
        for d in ["PT1H30M", "P3D", "P1Y2M3W4DT5H6M7S", "P1.5Y", "PT0,5S", "P1M", "PT1M"] {
            assert!(is_duration(d), "{d}");
        }
        for d in ["90 minutes", "P", "PT", "P1MT", "P1H", "PT1D", "P1M1Y", "P1.Y", "p1D", "P1D "] {
            assert!(!is_duration(d), "{d}");
        }
    }

    #[test]
    fn year_months() {
        assert!(is_year_month("2026-01") && is_year_month("0000-12"));
        assert!(!is_year_month("2026-00") && !is_year_month("2026-13") && !is_year_month("2026-1"));
    }

    #[test]
    fn instants_as_javascript_reads_them() {
        // Each figure is what Date.parse gives for the same text.
        assert_eq!(instant_of("2026-04-01T09:30:00Z"), 1_775_035_800_000.0);
        assert_eq!(instant_of("2026-04-01t09:30:00z"), 1_775_035_800_000.0);
        assert_eq!(instant_of("2026-04-01T09:30:00"), 1_775_035_800_000.0);
        assert_eq!(instant_of("2026-04-01T09:30:00.5+02:00"), 1_775_028_600_500.0);
        assert_eq!(instant_of("2026-04-01T09:30:00.1234567Z"), 1_775_035_800_123.0);
        assert_eq!(instant_of("2026-04-01T09:30:00.12Z"), 1_775_035_800_120.0);
        assert_eq!(instant_of("0025-12-10T09:00:00Z"), -61_348_546_800_000.0);
        assert_eq!(instant_of("0000-01-01T00:00:00Z"), -62_167_219_200_000.0);
        assert_eq!(instant_of("9999-12-31T23:59:59.999+23:59"), 253_402_214_459_999.0);
        assert!(instant_of("2026-04-01T23:59:60Z").is_nan());
        assert!(instant_of("2026-04-01").is_nan());
    }

    #[test]
    fn datetimes_order_by_instant() {
        let paris = instant_of("2026-04-01T10:00:00+02:00");
        let floating = instant_of("2026-04-01T08:30:00");
        let utc = instant_of("2026-04-01T09:00:00Z");
        assert!(paris < floating && floating < utc);
    }

    #[test]
    fn geopoints_and_geojson() {
        assert!(is_geopoint(&json!([-0.1276, 51.5072])));
        assert!(is_geopoint(&json!([180, -90])));
        assert!(!is_geopoint(&json!([51.5072, 200])));
        assert!(!is_geopoint(&json!([-0.1276])));
        assert!(!is_geopoint(&json!(["0", 0])));
        assert!(is_geojson(&json!({"type": "Point", "coordinates": [0, 0]})));
        assert!(is_geojson(&json!("{\"type\":\"Point\",\"coordinates\":[0,0]}")));
        assert!(!is_geojson(&json!({"coordinates": [0, 0]})));
        assert!(!is_geojson(&json!("not json")));
        assert!(!is_geojson(&json!([{"type": "Point"}])));
        assert!(!is_geojson(&json!({"type": 1})));
    }

    #[test]
    fn seconds_are_completed_for_browser_inputs() {
        assert_eq!(complete_seconds("time", "09:30").as_deref(), Some("09:30:00"));
        assert_eq!(complete_seconds("datetime", "2026-04-01T09:30").as_deref(), Some("2026-04-01T09:30:00"));
        assert_eq!(complete_seconds("time", "09:30:15"), None);
        assert_eq!(complete_seconds("datetime", "2026-04-01T09:30:00Z"), None);
        assert_eq!(complete_seconds("string", "09:30"), None);
        assert_eq!(complete_seconds("time", "half nine"), None);
        assert_eq!(complete_seconds("time", "24:00"), None);
    }
}
