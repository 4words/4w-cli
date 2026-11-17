//! Line diffs for the document: conflict resolution, remote-change preview and history.

use similar::{ChangeTag, TextDiff};

/// `(' ' | '+' | '-' | '~', text)`. Long unchanged runs collapse into a `~` marker line.
pub fn unified(old: &str, new: &str) -> Vec<(char, String)> {
    let diff = TextDiff::from_lines(old, new);
    let mut out: Vec<(char, String)> = Vec::new();
    let mut equal_run: Vec<String> = Vec::new();
    let flush = |run: &mut Vec<String>, out: &mut Vec<(char, String)>| {
        const KEEP: usize = 2;
        if run.len() > KEEP * 2 + 1 {
            for line in &run[..KEEP] {
                out.push((' ', line.clone()));
            }
            out.push(('~', format!("{} unchanged lines", run.len() - KEEP * 2)));
            for line in &run[run.len() - KEEP..] {
                out.push((' ', line.clone()));
            }
        } else {
            for line in run.iter() {
                out.push((' ', line.clone()));
            }
        }
        run.clear();
    };
    for change in diff.iter_all_changes() {
        let text = change.value().trim_end_matches('\n').to_string();
        match change.tag() {
            ChangeTag::Equal => equal_run.push(text),
            ChangeTag::Delete => {
                flush(&mut equal_run, &mut out);
                out.push(('-', text));
            }
            ChangeTag::Insert => {
                flush(&mut equal_run, &mut out);
                out.push(('+', text));
            }
        }
    }
    flush(&mut equal_run, &mut out);
    out
}

/// `(additions, deletions)` between two texts.
pub fn stats(old: &str, new: &str) -> (usize, usize) {
    let diff = TextDiff::from_lines(old, new);
    diff.iter_all_changes().fold((0, 0), |(a, d), c| match c.tag() {
        ChangeTag::Insert => (a + 1, d),
        ChangeTag::Delete => (a, d + 1),
        ChangeTag::Equal => (a, d),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn marks_changes_and_collapses_long_equal_runs() {
        let old = (1..=20).map(|n| format!("l{n}")).collect::<Vec<_>>().join("\n") + "\n";
        let new = old.replace("l10\n", "l10 changed\n");
        let d = unified(&old, &new);
        assert!(d.contains(&('-', "l10".into())) && d.contains(&('+', "l10 changed".into())));
        assert!(d.iter().any(|(t, s)| *t == '~' && s.contains("unchanged")));
        assert_eq!(stats(&old, &new), (1, 1));
    }
}
