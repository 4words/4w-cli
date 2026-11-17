//! Text helpers: cell-width aware wrapping/clipping and small formatters.

use chrono::{Datelike, Local, TimeZone};
use unicode_segmentation::UnicodeSegmentation;
use unicode_width::UnicodeWidthStr;

pub fn width(s: &str) -> usize {
    UnicodeWidthStr::width(s)
}

/// Clips to `max` cells, ending with `…` (or `...` in ASCII) when cut.
pub fn clip(s: &str, max: usize, ellipsis: &str) -> String {
    if width(s) <= max {
        return s.to_string();
    }
    let ell = width(ellipsis);
    if max <= ell {
        return s
            .graphemes(true)
            .scan(0usize, |w, g| {
                *w += width(g);
                (*w <= max).then_some(g)
            })
            .collect();
    }
    let mut out = String::new();
    let mut w = 0;
    for g in s.graphemes(true) {
        let gw = width(g);
        if w + gw > max - ell {
            break;
        }
        out.push_str(g);
        w += gw;
    }
    out.push_str(ellipsis);
    out
}

/// Word-wraps `text` into lines of at most `max` cells. Newlines are kept; words longer than the
/// line are split at grapheme boundaries.
pub fn wrap(text: &str, max: usize) -> Vec<String> {
    let max = max.max(1);
    let mut out = Vec::new();
    for logical in text.split('\n') {
        if width(logical) <= max {
            out.push(logical.to_string());
            continue;
        }
        let mut line = String::new();
        let mut line_w = 0usize;
        for word in logical.split_inclusive(' ') {
            let word_w = width(word.trim_end_matches(' '));
            let full_w = width(word);
            if line_w + word_w > max && !line.is_empty() {
                out.push(line.trim_end().to_string());
                line = String::new();
                line_w = 0;
            }
            if word_w > max {
                for g in word.graphemes(true) {
                    let gw = width(g);
                    if line_w + gw > max {
                        out.push(std::mem::take(&mut line));
                        line_w = 0;
                    }
                    line.push_str(g);
                    line_w += gw;
                }
            } else {
                line.push_str(word);
                line_w += full_w;
            }
        }
        out.push(line.trim_end().to_string());
    }
    out
}

pub fn fmt(template: &str, pairs: &[(&str, &str)]) -> String {
    let mut out = template.to_string();
    for (key, value) in pairs {
        out = out.replace(&format!("{{{key}}}"), value);
    }
    out
}

/// `HH:MM` in local time.
pub fn clock(ts_ms: u64) -> String {
    match Local.timestamp_millis_opt(ts_ms as i64).single() {
        Some(t) if ts_ms > 0 => t.format("%H:%M").to_string(),
        _ => "--:--".into(),
    }
}

/// Local calendar day number (for day separators).
pub fn day_of(ts_ms: u64) -> i32 {
    Local.timestamp_millis_opt(ts_ms as i64).single().map(|t| t.num_days_from_ce()).unwrap_or(0)
}

pub fn day_label(ts_ms: u64) -> String {
    Local.timestamp_millis_opt(ts_ms as i64).single().map(|t| t.format("%a %d %b %Y").to_string()).unwrap_or_default()
}

/// `23h41m`, `41m`, `59s`.
pub fn duration_short(secs: u64) -> String {
    if secs >= 3600 {
        format!("{}h{:02}m", secs / 3600, (secs % 3600) / 60)
    } else if secs >= 60 {
        format!("{}m", secs / 60)
    } else {
        format!("{secs}s")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wraps_by_cells_and_splits_long_words() {
        assert_eq!(wrap("aaa bbb ccc", 7), vec!["aaa bbb", "ccc"]);
        assert_eq!(wrap("abcdefghij", 4), vec!["abcd", "efgh", "ij"]);
        assert_eq!(wrap("a\n\nb", 5), vec!["a", "", "b"]);
        assert_eq!(wrap("日本語日本語", 6), vec!["日本語", "日本語"]);
    }

    #[test]
    fn clips_with_ellipsis() {
        assert_eq!(clip("hello world", 8, "…"), "hello w…");
        assert_eq!(clip("hi", 8, "…"), "hi");
        assert_eq!(fmt("{n} online", &[("n", "3")]), "3 online");
        assert_eq!(duration_short(3 * 3600 + 41 * 60), "3h41m");
    }
}
