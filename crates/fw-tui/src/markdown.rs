//! Markdown → styled terminal lines (CommonMark + tables, strikethrough and task lists).

use crate::text::{clip, width};
use crate::theme::Theme;
use pulldown_cmark::{CodeBlockKind, Event, HeadingLevel, Options, Parser, Tag, TagEnd};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};

struct Renderer<'t> {
    th: &'t Theme,
    width: usize,
    lines: Vec<Line<'static>>,
    cur: Vec<Span<'static>>,
    cur_w: usize,
    styles: Vec<Style>,
    quote_depth: usize,
    lists: Vec<Option<u64>>,
    marker: Option<String>,
    in_code: bool,
    code_lang: String,
    link: Option<String>,
    table: Option<Vec<Vec<String>>>,
    cell: String,
    heading: Option<HeadingLevel>,
    first_block: bool,
}

impl<'t> Renderer<'t> {
    fn style(&self) -> Style {
        self.styles.last().copied().unwrap_or(self.th.text)
    }

    fn prefix_spans(&self, first: bool) -> Vec<Span<'static>> {
        let mut spans = Vec::new();
        let bar = if self.th.unicode { "│ " } else { "| " };
        for _ in 0..self.quote_depth {
            spans.push(Span::styled(bar, self.th.quote));
        }
        let indent = self.lists.len().saturating_sub(1) * 2;
        if indent > 0 || self.marker.is_some() || !self.lists.is_empty() {
            spans.push(Span::raw(" ".repeat(indent)));
            if first {
                // marker is consumed by the caller on the first line of an item
            } else if !self.lists.is_empty() {
                spans.push(Span::raw("  "));
            }
        }
        spans
    }

    fn prefix_width(&self) -> usize {
        let quote = self.quote_depth * 2;
        let list = if self.lists.is_empty() { 0 } else { self.lists.len().saturating_sub(1) * 2 + 2 };
        quote + list
    }

    fn flush(&mut self) {
        if self.cur.is_empty() && self.marker.is_none() {
            return;
        }
        let mut spans = self.prefix_spans(self.marker.is_some());
        if let Some(marker) = self.marker.take() {
            spans.push(Span::styled(marker, self.th.accent));
        }
        spans.append(&mut self.cur);
        self.lines.push(Line::from(spans));
        self.cur_w = 0;
    }

    fn blank(&mut self) {
        if !self.lines.is_empty() && !self.lines.last().is_some_and(|l| l.spans.is_empty()) {
            self.lines.push(Line::default());
        }
    }

    fn avail(&self) -> usize {
        self.width.saturating_sub(self.prefix_width()).max(4)
    }

    fn word(&mut self, word: &str, style: Style) {
        if word.is_empty() {
            return;
        }
        if let Some(table) = self.table.as_mut() {
            let _ = table;
            self.cell.push_str(word);
            return;
        }
        let w = width(word);
        if self.cur_w + w > self.avail() && self.cur_w > 0 {
            self.flush();
        }
        let style = if self.link.is_some() { self.th.link.patch(style) } else { style };
        self.cur.push(Span::styled(word.to_string(), style));
        self.cur_w += w;
    }

    fn text(&mut self, text: &str) {
        let style = self.style();
        for chunk in text.split_inclusive(char::is_whitespace) {
            let trimmed = chunk.trim_end_matches(char::is_whitespace);
            let spaces = chunk.len() - trimmed.len();
            if !trimmed.is_empty() {
                // very long tokens (URLs) are split to the available width
                let mut rest = trimmed;
                while width(rest) > self.avail() {
                    let head = clip(rest, self.avail(), "");
                    if head.is_empty() {
                        break;
                    }
                    let take = head.len();
                    if self.cur_w > 0 {
                        self.flush();
                    }
                    self.word(&head, style);
                    self.flush();
                    rest = &rest[take..];
                }
                self.word(rest, style);
            }
            if spaces > 0 && self.cur_w > 0 && self.cur_w < self.avail() {
                self.cur.push(Span::styled(" ", style));
                self.cur_w += 1;
            }
        }
    }

    fn start_block(&mut self) {
        if !self.first_block && self.lists.is_empty() {
            self.blank();
        }
        self.first_block = false;
    }

    fn render_table(&mut self, rows: Vec<Vec<String>>) {
        if rows.is_empty() {
            return;
        }
        let cols = rows.iter().map(Vec::len).max().unwrap_or(0);
        let sep = if self.th.unicode { " │ " } else { " | " };
        let budget = self.avail().saturating_sub((cols.saturating_sub(1)) * 3);
        let mut widths = vec![1usize; cols];
        for row in &rows {
            for (i, cell) in row.iter().enumerate() {
                widths[i] = widths[i].max(width(cell));
            }
        }
        while widths.iter().sum::<usize>() > budget && widths.iter().any(|w| *w > 3) {
            if let Some((i, _)) = widths.iter().enumerate().max_by_key(|(_, w)| **w) {
                widths[i] -= 1;
            }
        }
        for (r, row) in rows.iter().enumerate() {
            let mut spans = Vec::new();
            for (i, w) in widths.iter().enumerate() {
                let cell = row.get(i).map(String::as_str).unwrap_or("");
                let clipped = clip(cell, *w, if self.th.unicode { "…" } else { "." });
                let pad = w.saturating_sub(width(&clipped));
                let style = if r == 0 { self.th.heading } else { self.th.text };
                spans.push(Span::styled(format!("{clipped}{}", " ".repeat(pad)), style));
                if i + 1 < widths.len() {
                    spans.push(Span::styled(sep, self.th.dim));
                }
            }
            self.lines.push(Line::from(spans));
            if r == 0 {
                let rule = if self.th.unicode { "─" } else { "-" };
                self.lines.push(Line::from(Span::styled(rule.repeat(widths.iter().sum::<usize>() + cols.saturating_sub(1) * 3), self.th.dim)));
            }
        }
    }
}

/// Renders `markdown` for a pane `width` cells wide.
pub fn render(markdown: &str, pane_width: usize, th: &Theme) -> Vec<Line<'static>> {
    let options = Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TASKLISTS;
    let mut r = Renderer {
        th,
        width: pane_width.max(8),
        lines: Vec::new(),
        cur: Vec::new(),
        cur_w: 0,
        styles: Vec::new(),
        quote_depth: 0,
        lists: Vec::new(),
        marker: None,
        in_code: false,
        code_lang: String::new(),
        link: None,
        table: None,
        cell: String::new(),
        heading: None,
        first_block: true,
    };
    let bullet = th.sym().bullet;
    for event in Parser::new_ext(markdown, options) {
        match event {
            Event::Start(tag) => match tag {
                Tag::Paragraph => r.start_block(),
                Tag::Heading { level, .. } => {
                    r.start_block();
                    r.heading = Some(level);
                    let hashes = "#".repeat(level as usize);
                    r.styles.push(th.heading);
                    r.cur.push(Span::styled(format!("{hashes} "), th.dim));
                    r.cur_w += hashes.len() + 1;
                }
                Tag::BlockQuote(_) => {
                    r.start_block();
                    r.quote_depth += 1;
                    r.styles.push(th.quote);
                }
                Tag::CodeBlock(kind) => {
                    r.start_block();
                    r.in_code = true;
                    r.code_lang = match kind {
                        CodeBlockKind::Fenced(lang) => lang.to_string(),
                        CodeBlockKind::Indented => String::new(),
                    };
                }
                Tag::List(start) => {
                    if r.lists.is_empty() {
                        r.start_block();
                    } else {
                        r.flush();
                    }
                    r.lists.push(start);
                }
                Tag::Item => {
                    r.flush();
                    let marker = match r.lists.last_mut() {
                        Some(Some(n)) => {
                            let m = format!("{n}. ");
                            *n += 1;
                            m
                        }
                        _ => format!("{bullet} "),
                    };
                    r.marker = Some(marker);
                }
                Tag::Emphasis => r.styles.push(r.style().add_modifier(Modifier::ITALIC)),
                Tag::Strong => r.styles.push(r.style().add_modifier(Modifier::BOLD)),
                Tag::Strikethrough => r.styles.push(r.style().add_modifier(Modifier::CROSSED_OUT)),
                Tag::Link { dest_url, .. } => r.link = Some(dest_url.to_string()),
                Tag::Table(_) => {
                    r.start_block();
                    r.table = Some(Vec::new());
                }
                Tag::TableHead | Tag::TableRow => {
                    if let Some(t) = r.table.as_mut() {
                        t.push(Vec::new());
                    }
                }
                Tag::TableCell => r.cell.clear(),
                _ => {}
            },
            Event::End(tag) => match tag {
                TagEnd::Paragraph => r.flush(),
                TagEnd::Heading(_) => {
                    r.styles.pop();
                    r.flush();
                    r.heading = None;
                }
                TagEnd::BlockQuote(_) => {
                    r.flush();
                    r.quote_depth = r.quote_depth.saturating_sub(1);
                    r.styles.pop();
                }
                TagEnd::CodeBlock => {
                    r.in_code = false;
                    r.code_lang.clear();
                }
                TagEnd::List(_) => {
                    r.flush();
                    r.lists.pop();
                }
                TagEnd::Item => r.flush(),
                TagEnd::Emphasis | TagEnd::Strong | TagEnd::Strikethrough => {
                    r.styles.pop();
                }
                TagEnd::Link => {
                    if let Some(url) = r.link.take() {
                        let shown = format!(" ({url})");
                        r.cur.push(Span::styled(shown.clone(), th.dim));
                        r.cur_w += width(&shown);
                    }
                }
                TagEnd::TableCell => {
                    let cell = std::mem::take(&mut r.cell);
                    if let Some(row) = r.table.as_mut().and_then(|t| t.last_mut()) {
                        row.push(cell.trim().to_string());
                    }
                }
                TagEnd::Table => {
                    if let Some(rows) = r.table.take() {
                        r.render_table(rows);
                    }
                }
                _ => {}
            },
            Event::Text(text) => {
                if r.in_code {
                    for code_line in text.split('\n').filter(|l| !(l.is_empty() && text.ends_with('\n') && std::ptr::eq(*l, text.rsplit('\n').next().unwrap_or("")))) {
                        let clipped = clip(code_line, r.avail().saturating_sub(2), if th.unicode { "…" } else { "." });
                        let mut spans = r.prefix_spans(false);
                        spans.push(Span::styled(format!("  {clipped}"), th.code));
                        r.lines.push(Line::from(spans));
                    }
                } else {
                    r.text(&text);
                }
            }
            Event::Code(code) => {
                let s = th.code;
                if r.table.is_some() {
                    r.cell.push_str(&code);
                } else {
                    r.styles.push(s);
                    r.text(&code);
                    r.styles.pop();
                }
            }
            Event::SoftBreak => {
                if r.table.is_some() {
                    r.cell.push(' ');
                } else {
                    r.text(" ");
                }
            }
            Event::HardBreak => r.flush(),
            Event::Rule => {
                r.start_block();
                r.lines.push(Line::from(Span::styled(th.sym().rule.repeat(r.avail().min(40)), th.dim)));
            }
            Event::TaskListMarker(done) => {
                let mark = if done { "[x] " } else { "[ ] " };
                let style = if done { th.ok } else { th.accent };
                if let Some(marker) = r.marker.take() {
                    r.marker = Some(format!("{marker}{mark}"));
                    let _ = style;
                }
            }
            Event::Html(html) | Event::InlineHtml(html) => {
                let styles = th.dim;
                r.styles.push(styles);
                r.text(&html);
                r.styles.pop();
            }
            _ => {}
        }
    }
    r.flush();
    while r.lines.last().is_some_and(|l| l.spans.is_empty()) {
        r.lines.pop();
    }
    r.lines
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::theme::ThemeName;

    fn plain(md: &str, w: usize) -> Vec<String> {
        let th = Theme::new(ThemeName::Mono, true);
        render(md, w, &th).iter().map(|l| l.spans.iter().map(|s| s.content.as_ref()).collect::<String>()).collect()
    }

    #[test]
    fn renders_headings_lists_tasks_quotes_code_and_tables() {
        let out = plain("# Title\n\n- one\n- [x] done\n  - nested\n\n> quote\n\n```\ncode line\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n", 40);
        let joined = out.join("\n");
        assert!(joined.contains("# Title"), "{joined}");
        assert!(joined.contains("• one") && joined.contains("[x] done"), "{joined}");
        assert!(joined.contains("│ quote"), "{joined}");
        assert!(joined.contains("code line"), "{joined}");
        assert!(joined.contains("a │ b") && joined.contains("1 │ 2"), "{joined}");
    }

    #[test]
    fn wraps_paragraphs_to_the_pane_width() {
        let out = plain("alpha beta gamma delta epsilon zeta", 14);
        assert!(out.len() >= 3 && out.iter().all(|l| width(l) <= 14), "{out:?}");
    }
}
