//! Interface language: `en` (default), `ptbr`, `es`. Resolution order matches the
//! TypeScript CLI: explicit value, `FOURWORDS_LANG`, saved `config.json`, then `en`.

use crate::config;
use std::sync::RwLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Lang {
    En,
    PtBr,
    Es,
}

impl Lang {
    pub const ALL: [Lang; 3] = [Lang::En, Lang::PtBr, Lang::Es];

    pub fn code(self) -> &'static str {
        match self {
            Lang::En => "en",
            Lang::PtBr => "ptbr",
            Lang::Es => "es",
        }
    }

    pub fn next(self) -> Lang {
        match self {
            Lang::En => Lang::PtBr,
            Lang::PtBr => Lang::Es,
            Lang::Es => Lang::En,
        }
    }
}

/// Accepts `en`, `en-US`, `pt`, `pt_BR`, `portugues`, `es-419`, `espanol`... like `normalizeLang` in TS.
pub fn normalize(raw: Option<&str>) -> Option<Lang> {
    let clean: String = raw?.trim().to_lowercase().replace(['_', '-'], "");
    if clean.is_empty() {
        return None;
    }
    if clean == "en" || clean.starts_with("enus") || clean.starts_with("engb") || clean == "english" {
        return Some(Lang::En);
    }
    if clean == "ptbr" || clean == "pt" || clean.starts_with("ptpt") || clean.starts_with("portugu") {
        return Some(Lang::PtBr);
    }
    if clean == "es" || clean.starts_with("eses") || clean.starts_with("es419") || clean.starts_with("espan") {
        return Some(Lang::Es);
    }
    None
}

static OVERRIDE: RwLock<Option<Lang>> = RwLock::new(None);

/// Forces a language for this process (used by `--lang` and the in-TUI language switch).
pub fn set_override(lang: Lang) {
    if let Ok(mut slot) = OVERRIDE.write() {
        *slot = Some(lang);
    }
}

pub fn resolve() -> Lang {
    if let Ok(slot) = OVERRIDE.read()
        && let Some(lang) = *slot
    {
        return lang;
    }
    normalize(std::env::var("FOURWORDS_LANG").ok().as_deref()).or_else(config::saved_lang).unwrap_or(Lang::En)
}

/// Picks the string for the active language: `tr("English", "Português", "Español")`.
pub fn tr<'a>(en: &'a str, ptbr: &'a str, es: &'a str) -> &'a str {
    match resolve() {
        Lang::En => en,
        Lang::PtBr => ptbr,
        Lang::Es => es,
    }
}

/// Same as [`tr`] but returns an owned string, convenient inside `format!` chains.
pub fn trs(en: impl Into<String>, ptbr: impl Into<String>, es: impl Into<String>) -> String {
    match resolve() {
        Lang::En => en.into(),
        Lang::PtBr => ptbr.into(),
        Lang::Es => es.into(),
    }
}
