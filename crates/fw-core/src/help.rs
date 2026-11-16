//! Trilingual help. The text is generated from the TypeScript implementation
//! (`bun scripts/export-help.mjs`) so both stay byte-for-byte identical; `{version}` is substituted.

use crate::error::{Error, Result};
use crate::lang::Lang;
use serde_json::Value;
use std::sync::OnceLock;

fn data() -> &'static Value {
    static DATA: OnceLock<Value> = OnceLock::new();
    DATA.get_or_init(|| serde_json::from_str(include_str!("../data/help.json")).expect("help.json is valid JSON"))
}

fn render(text: &str) -> String {
    text.replace("{version}", crate::VERSION)
}

/// General help (`topic = None`/empty) or help for one command, e.g. `"room save"`.
pub fn help(topic: Option<&str>, lang: Lang) -> Result<String> {
    let section = &data()[lang.code()];
    match topic.filter(|t| !t.is_empty()) {
        None => Ok(render(section["general"].as_str().unwrap_or_default())),
        Some(topic) => match section["topics"][topic].as_str() {
            Some(text) => Ok(render(text)),
            None => Err(Error::usage(match lang {
                Lang::En => format!("Unknown topic: {topic}. See 4w --help."),
                Lang::Es => format!("Tema desconocido: {topic}. Consulte 4w --help."),
                Lang::PtBr => format!("Tópico desconhecido: {topic}. Consulte 4w --help."),
            })),
        },
    }
}

/// Resolves `4w help X Y`, `4w --help`, `4w room save --help` to a topic (`Some("")` = general).
pub fn help_topic(args: &[String]) -> Option<String> {
    if args.first().map(String::as_str) == Some("help") {
        return Some(args[1..].join(" "));
    }
    let end = args.iter().position(|a| a == "--").unwrap_or(args.len());
    let options = &args[..end];
    if matches!(options.first().map(String::as_str), Some("--help" | "-h")) {
        return Some(String::new());
    }
    let subcommand = options.first().is_some_and(|c| c == "room" || c == "mcp")
        && options.get(1).is_some_and(|s| !s.starts_with('-'));
    let offset = if subcommand { 2 } else { 1 };
    if options.len() == offset + 1 && matches!(options[offset].as_str(), "--help" | "-h") {
        return Some(options[..offset].join(" "));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn a(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn general_and_topic_help_in_three_languages() {
        assert!(help(None, Lang::En).unwrap().contains("FourWords in the terminal"));
        assert!(help(None, Lang::PtBr).unwrap().contains("Abre o painel interativo"));
        assert!(help(None, Lang::Es).unwrap().contains("Abre el panel interactivo"));
        assert!(help(Some("update"), Lang::En).unwrap().contains("4w update [--check] [--force]"));
        assert!(help(Some("room watch"), Lang::En).unwrap().contains("Live room panel"));
        assert!(help(Some("nope"), Lang::En).is_err());
        assert!(help(None, Lang::En).unwrap().starts_with(&format!("4w {} ", crate::VERSION)));
    }

    #[test]
    fn topic_resolution_matches_typescript() {
        assert_eq!(help_topic(&a(&["help", "room", "save"])).as_deref(), Some("room save"));
        assert_eq!(help_topic(&a(&["--help"])).as_deref(), Some(""));
        assert_eq!(help_topic(&a(&["room", "save", "--help"])).as_deref(), Some("room save"));
        assert_eq!(help_topic(&a(&["update", "--help"])).as_deref(), Some("update"));
        assert_eq!(help_topic(&a(&["room", "send", "x", "--help"])), None);
    }
}
