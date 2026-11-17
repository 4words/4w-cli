//! Version comparison (dot-separated numbers, like the TypeScript `compareSemver`).

use std::cmp::Ordering;

fn parts(v: &str) -> Vec<u64> {
    v.split('.')
        .map(|p| {
            let digits: String = p.chars().take_while(char::is_ascii_digit).collect();
            digits.parse().unwrap_or(0)
        })
        .collect()
}

pub fn compare(a: &str, b: &str) -> Ordering {
    let (pa, pb) = (parts(a), parts(b));
    for i in 0..pa.len().max(pb.len()) {
        let (x, y) = (pa.get(i).copied().unwrap_or(0), pb.get(i).copied().unwrap_or(0));
        match x.cmp(&y) {
            Ordering::Equal => {}
            other => return other,
        }
    }
    Ordering::Equal
}

pub fn is_newer(candidate: &str, current: &str) -> bool {
    compare(candidate, current) == Ordering::Greater
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_like_the_typescript_cli() {
        assert!(is_newer("0.3.2", "0.3.1"));
        assert!(!is_newer("0.3.1", "0.3.2"));
        assert_eq!(compare("0.3.2", "0.3.2"), Ordering::Equal);
        assert!(is_newer("1.0.0", "0.9.9"));
        assert!(is_newer("0.10.0", "0.9.5"));
        assert_eq!(compare("0.3.2", "0.3.2.1"), Ordering::Less);
    }
}
