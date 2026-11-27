//! Addresses: `<path>[#<key>=<value>[&<key>=<value>]*]` (SPEC section 10),
//! parsed, written, and a view found by one, as `.table`'s TypeScript
//! `address` module gives them (it calls these). Keys and values are
//! percent-encoded as JavaScript's `encodeURIComponent` writes them and read
//! as its `decodeURIComponent` does, so an address round-trips between them.

use std::borrow::Cow;

use workspace_edn::formula::json_string;

/// An address, parsed. The reserved keys have fields; any other key is kept
/// in `extra`, in the order first written, so an app's own keys round-trip.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Address {
    pub table_path: String,
    pub table_name: Option<String>,
    pub row_id: Option<String>,
    pub view_id: Option<String>,
    pub field_name: Option<String>,
    pub extra: Vec<(String, String)>,
}

/// A key or value as written: percent-decoded. One that isn't valid
/// percent-encoding of UTF-8, as an address written before values were
/// encoded may be, is read as it stands.
fn decoded(text: &str) -> Cow<'_, str> {
    if !text.contains('%') {
        return Cow::Borrowed(text);
    }
    let b = text.as_bytes();
    let hex = |i: usize| b.get(i).and_then(|c| (*c as char).to_digit(16));
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let (Some(high), Some(low)) = (hex(i + 1), hex(i + 2)) else { return Cow::Borrowed(text) };
            out.push((high * 16 + low) as u8);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_or(Cow::Borrowed(text), Cow::Owned)
}

/// `text` percent-encoded as `encodeURIComponent` writes it: everything but
/// letters, digits and `-_.!~*'()`, as UTF-8 bytes in upper-case hex.
fn encode(out: &mut String, text: &str) {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    for &c in text.as_bytes() {
        if c.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&c) {
            out.push(c as char);
        } else {
            out.push('%');
            out.push(HEX[usize::from(c >> 4)] as char);
            out.push(HEX[usize::from(c & 15)] as char);
        }
    }
}

/// Parse an address. None when it's empty or has no path, the one part it
/// needs. Empty fragments, keys without values and unknown keys are passed
/// over or kept, never refused (readers MUST tolerate unknown keys).
pub fn parse(input: &str) -> Option<Address> {
    let (path, fragment) = match input.split_once('#') {
        Some((path, fragment)) => (path, Some(fragment)),
        None => (input, None),
    };
    if path.is_empty() {
        return None;
    }
    let mut out = Address { table_path: path.to_string(), ..Address::default() };
    for pair in fragment.unwrap_or("").split('&') {
        let Some((key, value)) = pair.split_once('=') else { continue };
        let (key, value) = (decoded(key), decoded(value));
        if key.is_empty() || value.is_empty() {
            continue;
        }
        let value = value.into_owned();
        match &*key {
            "table" => out.table_name = Some(value),
            "row" => out.row_id = Some(value),
            "view" => out.view_id = Some(value),
            "field" => out.field_name = Some(value),
            _ => match out.extra.iter_mut().find(|(k, _)| *k == *key) {
                // A key written twice keeps its first place and its last value, as a JavaScript object would.
                Some(kept) => kept.1 = value,
                None => out.extra.push((key.into_owned(), value)),
            },
        }
    }
    Some(out)
}

/// Write an address back: it parses to the same. With no keys set, the bare
/// path, with no `#`.
pub fn format(address: &Address) -> String {
    let mut out = address.table_path.clone();
    let mut first = true;
    let reserved = [("table", &address.table_name), ("row", &address.row_id), ("view", &address.view_id), ("field", &address.field_name)];
    let pairs = reserved
        .iter()
        .filter_map(|(k, v)| v.as_deref().filter(|v| !v.is_empty()).map(|v| (*k, v)))
        .chain(address.extra.iter().map(|(k, v)| (k.as_str(), v.as_str())));
    for (key, value) in pairs {
        out.push(if first { '#' } else { '&' });
        first = false;
        encode(&mut out, key);
        out.push('=');
        encode(&mut out, value);
    }
    out
}

/// Which view an address's `view=` names: the one with that id, else the
/// first whose name matches it, ignoring case ("pipeline" finds "Pipeline").
/// Ids are opaque (D23); a name is what a reader types.
pub fn addressed_view<'a>(views: impl Iterator<Item = (&'a str, &'a str)> + Clone, key: &str) -> Option<usize> {
    if let Some(i) = views.clone().position(|(id, _)| id == key) {
        return Some(i);
    }
    let lower = key.to_lowercase();
    views.into_iter().position(|(_, name)| name.to_lowercase() == lower)
}

/// Whether a path names a `.table`, either form (SPEC section 13): its
/// extension, with or without a folder's trailing `/`.
pub fn is_table_path(path: &str) -> bool {
    let path = path.strip_suffix('/').unwrap_or(path).as_bytes();
    path.len() >= 6 && path[path.len() - 6..].eq_ignore_ascii_case(b".table")
}

/// The address as JSON, in the shape the TypeScript `Address` has.
pub fn address_json(out: &mut String, address: &Address) {
    out.push_str("{\"tablePath\":");
    json_string(out, &address.table_path);
    for (key, value) in [("tableName", &address.table_name), ("rowId", &address.row_id), ("viewId", &address.view_id), ("fieldName", &address.field_name)] {
        if let Some(v) = value {
            out.push_str(",\"");
            out.push_str(key);
            out.push_str("\":");
            json_string(out, v);
        }
    }
    if !address.extra.is_empty() {
        out.push_str(",\"extra\":{");
        for (i, (k, v)) in address.extra.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            json_string(out, k);
            out.push(':');
            json_string(out, v);
        }
        out.push('}');
    }
    out.push('}');
}

#[cfg(test)]
mod tests {
    use super::*;

    fn some(s: &str) -> Option<String> {
        Some(s.to_string())
    }

    #[test]
    fn parses_every_reserved_key_and_keeps_the_rest() {
        let a = parse("../crm.table#table=deals&row=r1&view=Pipeline&field=amount&query=open&highlight=x").unwrap();
        assert_eq!(a.table_path, "../crm.table");
        assert_eq!((a.table_name, a.row_id, a.view_id, a.field_name), (some("deals"), some("r1"), some("Pipeline"), some("amount")));
        assert_eq!(a.extra, vec![("query".into(), "open".into()), ("highlight".into(), "x".into())]);
    }

    #[test]
    fn tolerates_what_it_cannot_read() {
        assert_eq!(parse(""), None);
        assert_eq!(parse("#row=r1"), None);
        assert_eq!(parse("a.table#").unwrap(), Address { table_path: "a.table".into(), ..Address::default() });
        let a = parse("a.table#&row&=x&row=&view=v&view=w").unwrap();
        assert_eq!((a.row_id, a.view_id), (None, some("w")));
        let a = parse("a.table#k=1&j=2&k=3").unwrap();
        assert_eq!(a.extra, vec![("k".into(), "3".into()), ("j".into(), "2".into())]);
    }

    #[test]
    fn percent_encoding_round_trips_as_javascript_writes_it() {
        let a = Address { table_path: "my tables/crm.table".into(), view_id: some("Q3 & Q4 = 50%"), extra: vec![("ünï".into(), "a/b?c#d".into())], ..Address::default() };
        let text = format(&a);
        assert_eq!(text, "my tables/crm.table#view=Q3%20%26%20Q4%20%3D%2050%25&%C3%BCn%C3%AF=a%2Fb%3Fc%23d");
        assert_eq!(parse(&text).unwrap(), a);
        assert_eq!(format(&Address { table_path: "x".into(), row_id: some("-_.!~*'()"), ..Address::default() }), "x#row=-_.!~*'()");
        // Not valid percent-encoding: read as it stands.
        assert_eq!(parse("x#view=100%").unwrap().view_id, some("100%"));
        assert_eq!(parse("x#view=%E2%82").unwrap().view_id, some("%E2%82"));
        assert_eq!(parse("x#view=%e2%82%ac").unwrap().view_id, some("€"));
        assert_eq!(format(&Address { table_path: "x".into(), ..Address::default() }), "x");
    }

    #[test]
    fn views_by_id_then_name() {
        let views = [("v1", "Pipeline"), ("pipeline", "Other"), ("v3", "Board")];
        assert_eq!(addressed_view(views.iter().copied(), "pipeline"), Some(1));
        assert_eq!(addressed_view(views.iter().copied(), "BOARD"), Some(2));
        assert_eq!(addressed_view(views.iter().copied(), "nothing"), None);
    }

    #[test]
    fn table_paths() {
        for p in ["crm.table", "a/crm.TABLE/", "x.Table"] {
            assert!(is_table_path(p), "{p}");
        }
        for p in ["crm.tables", "crm.table//", "table", "crm.table.zip", ""] {
            assert!(!is_table_path(p), "{p}");
        }
    }
}
