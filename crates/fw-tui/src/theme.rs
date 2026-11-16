//! Colors and symbols. Named ANSI colors are used on purpose: they follow the terminal's own
//! palette (and the desktop widget's), so contrast is the user's choice, not ours.

use ratatui::style::{Color, Modifier, Style};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThemeName {
    Dark,
    Light,
    HighContrast,
    /// `NO_COLOR`: modifiers only (bold, dim, reverse, underline).
    Mono,
}

#[derive(Debug, Clone)]
pub struct Theme {
    pub name: ThemeName,
    pub unicode: bool,
    pub text: Style,
    pub dim: Style,
    pub accent: Style,
    pub brand: Style,
    pub ok: Style,
    pub warn: Style,
    pub err: Style,
    pub selected: Style,
    pub border: Style,
    pub border_focus: Style,
    pub mention: Style,
    pub heading: Style,
    pub code: Style,
    pub link: Style,
    pub quote: Style,
    pub diff_add: Style,
    pub diff_del: Style,
    pub nick_colors: Vec<Style>,
}

fn fg(color: Color) -> Style {
    Style::default().fg(color)
}

impl Theme {
    pub fn new(name: ThemeName, unicode: bool) -> Theme {
        let bold = Modifier::BOLD;
        let mut theme = match name {
            ThemeName::Dark => Theme {
                name,
                unicode,
                text: Style::default(),
                dim: fg(Color::DarkGray),
                accent: fg(Color::Cyan).add_modifier(bold),
                brand: fg(Color::Magenta).add_modifier(bold),
                ok: fg(Color::Green),
                warn: fg(Color::Yellow),
                err: fg(Color::Red).add_modifier(bold),
                selected: Style::default().fg(Color::White).bg(Color::Magenta).add_modifier(bold),
                border: fg(Color::DarkGray),
                border_focus: fg(Color::Cyan),
                mention: fg(Color::Yellow).add_modifier(bold),
                heading: fg(Color::Cyan).add_modifier(bold),
                code: fg(Color::Yellow),
                link: fg(Color::Blue).add_modifier(Modifier::UNDERLINED),
                quote: fg(Color::DarkGray).add_modifier(Modifier::ITALIC),
                diff_add: fg(Color::Green),
                diff_del: fg(Color::Red),
                nick_colors: vec![Color::Cyan, Color::Green, Color::Magenta, Color::Yellow, Color::Blue, Color::LightRed]
                    .into_iter()
                    .map(|c| fg(c).add_modifier(bold))
                    .collect(),
            },
            ThemeName::Light => Theme {
                name,
                unicode,
                text: Style::default(),
                dim: fg(Color::Gray),
                accent: fg(Color::Blue).add_modifier(bold),
                brand: fg(Color::Magenta).add_modifier(bold),
                ok: fg(Color::Green),
                warn: fg(Color::Rgb(160, 100, 0)),
                err: fg(Color::Red).add_modifier(bold),
                selected: Style::default().fg(Color::White).bg(Color::Blue).add_modifier(bold),
                border: fg(Color::Gray),
                border_focus: fg(Color::Blue),
                mention: fg(Color::Rgb(160, 100, 0)).add_modifier(bold),
                heading: fg(Color::Blue).add_modifier(bold),
                code: fg(Color::Rgb(160, 60, 0)),
                link: fg(Color::Blue).add_modifier(Modifier::UNDERLINED),
                quote: fg(Color::Gray).add_modifier(Modifier::ITALIC),
                diff_add: fg(Color::Green),
                diff_del: fg(Color::Red),
                nick_colors: vec![Color::Blue, Color::Green, Color::Magenta, Color::Red, Color::Cyan]
                    .into_iter()
                    .map(|c| fg(c).add_modifier(bold))
                    .collect(),
            },
            ThemeName::HighContrast => Theme {
                name,
                unicode,
                text: fg(Color::White),
                dim: fg(Color::Gray),
                accent: fg(Color::LightCyan).add_modifier(bold),
                brand: fg(Color::LightMagenta).add_modifier(bold),
                ok: fg(Color::LightGreen).add_modifier(bold),
                warn: fg(Color::LightYellow).add_modifier(bold),
                err: fg(Color::LightRed).add_modifier(bold),
                selected: Style::default().fg(Color::Black).bg(Color::White).add_modifier(bold),
                border: fg(Color::White),
                border_focus: fg(Color::LightYellow).add_modifier(bold),
                mention: Style::default().fg(Color::Black).bg(Color::LightYellow).add_modifier(bold),
                heading: fg(Color::LightCyan).add_modifier(bold | Modifier::UNDERLINED),
                code: fg(Color::LightYellow),
                link: fg(Color::LightBlue).add_modifier(Modifier::UNDERLINED),
                quote: fg(Color::Gray).add_modifier(Modifier::ITALIC),
                diff_add: fg(Color::LightGreen).add_modifier(bold),
                diff_del: fg(Color::LightRed).add_modifier(bold),
                nick_colors: vec![Color::LightCyan, Color::LightGreen, Color::LightMagenta, Color::LightYellow, Color::LightBlue]
                    .into_iter()
                    .map(|c| fg(c).add_modifier(bold))
                    .collect(),
            },
            ThemeName::Mono => {
                let plain = Style::default();
                let b = plain.add_modifier(bold);
                Theme {
                    name,
                    unicode,
                    text: plain,
                    dim: plain.add_modifier(Modifier::DIM),
                    accent: b,
                    brand: b,
                    ok: plain,
                    warn: b,
                    err: b.add_modifier(Modifier::UNDERLINED),
                    selected: plain.add_modifier(Modifier::REVERSED),
                    border: plain,
                    border_focus: b,
                    mention: b.add_modifier(Modifier::REVERSED),
                    heading: b.add_modifier(Modifier::UNDERLINED),
                    code: plain.add_modifier(Modifier::ITALIC),
                    link: plain.add_modifier(Modifier::UNDERLINED),
                    quote: plain.add_modifier(Modifier::ITALIC),
                    diff_add: b,
                    diff_del: plain.add_modifier(Modifier::DIM),
                    nick_colors: vec![b, plain, plain.add_modifier(Modifier::ITALIC), plain.add_modifier(Modifier::UNDERLINED)],
                }
            }
        };
        if theme.nick_colors.is_empty() {
            theme.nick_colors.push(theme.accent);
        }
        theme
    }

    /// `NO_COLOR` → mono; `FOURWORDS_THEME=dark|light|contrast|mono`; `FOURWORDS_ASCII=1` → ASCII symbols.
    pub fn detect() -> Theme {
        let name = match std::env::var("FOURWORDS_THEME").ok().as_deref().map(str::to_lowercase).as_deref() {
            Some("light") => ThemeName::Light,
            Some("contrast" | "high-contrast" | "hc") => ThemeName::HighContrast,
            Some("mono") => ThemeName::Mono,
            Some("dark") => ThemeName::Dark,
            _ if std::env::var_os("NO_COLOR").is_some() => ThemeName::Mono,
            _ => ThemeName::Dark,
        };
        let utf8 = ["LC_ALL", "LC_CTYPE", "LANG"]
            .iter()
            .filter_map(|k| std::env::var(k).ok())
            .find(|v| !v.is_empty())
            .map(|v| v.to_uppercase().contains("UTF"))
            .unwrap_or(true);
        let unicode = utf8 && std::env::var("FOURWORDS_ASCII").as_deref() != Ok("1");
        Theme::new(name, unicode)
    }

    pub fn next(&self) -> Theme {
        let name = match self.name {
            ThemeName::Dark => ThemeName::Light,
            ThemeName::Light => ThemeName::HighContrast,
            ThemeName::HighContrast => ThemeName::Mono,
            ThemeName::Mono => ThemeName::Dark,
        };
        Theme::new(name, self.unicode)
    }

    /// Stable color per nickname (FNV-1a), so a person keeps their color.
    pub fn nick_style(&self, nick: &str) -> Style {
        let mut hash: u32 = 0x811c_9dc5;
        for byte in nick.bytes() {
            hash ^= u32::from(byte);
            hash = hash.wrapping_mul(0x0100_0193);
        }
        self.nick_colors[hash as usize % self.nick_colors.len()]
    }

    pub fn sym(&self) -> Sym {
        if self.unicode { Sym::UNICODE } else { Sym::ASCII }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct Sym {
    pub online: &'static str,
    pub offline: &'static str,
    pub busy: &'static str,
    pub bar: &'static str,
    pub rule: &'static str,
    pub bullet: &'static str,
    pub arrow: &'static str,
    pub ellipsis: &'static str,
    pub down: &'static str,
    pub check: &'static str,
    pub cross: &'static str,
    pub pending: &'static str,
    pub vline: &'static str,
    pub spinner: &'static [&'static str],
}

impl Sym {
    pub const UNICODE: Sym = Sym {
        online: "●",
        offline: "○",
        busy: "◐",
        bar: "▌",
        rule: "─",
        bullet: "•",
        arrow: "→",
        ellipsis: "…",
        down: "↓",
        check: "✓",
        cross: "✗",
        pending: "…",
        vline: "│",
        spinner: &["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
    };
    pub const ASCII: Sym = Sym {
        online: "*",
        offline: "o",
        busy: "~",
        bar: "|",
        rule: "-",
        bullet: "*",
        arrow: "->",
        ellipsis: "...",
        down: "v",
        check: "ok",
        cross: "x",
        pending: "..",
        vline: "|",
        spinner: &["|", "/", "-", "\\"],
    };
}
