//! Rendering. `draw` is a pure function of the [`App`] state (plus caches), so every screen can be
//! snapshot-tested on a `TestBackend`.

use crate::app::*;
use crate::markdown;
use crate::text::{self, clip, clock, day_label, day_of, duration_short, fmt, width, wrap};
use fw_room::{Conn, Participant, Role, Transport};
use ratatui::Frame;
use ratatui::layout::{Alignment, Constraint, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Borders, Clear, Gauge, Paragraph, Scrollbar, ScrollbarOrientation, ScrollbarState};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Layout3 {
    Wide,
    Medium,
    Tabs,
}

fn layout_for(width: u16) -> Layout3 {
    if width >= 120 {
        Layout3::Wide
    } else if width >= 80 {
        Layout3::Medium
    } else {
        Layout3::Tabs
    }
}

fn border_type(app: &App) -> BorderType {
    if app.theme.unicode { BorderType::Rounded } else { BorderType::Plain }
}

fn pane_block<'a>(app: &App, title: Line<'a>, focused: bool) -> Block<'a> {
    let style = if focused { app.theme.border_focus } else { app.theme.border };
    Block::bordered().border_type(border_type(app)).border_style(style).title(title)
}

fn title_line<'a>(app: &App, label: String, focused: bool) -> Line<'a> {
    let style = if focused { app.theme.accent } else { app.theme.dim };
    Line::from(vec![Span::raw(" "), Span::styled(label, style), Span::raw(" ")])
}

pub fn centered(area: Rect, w: u16, h: u16) -> Rect {
    let w = w.min(area.width.saturating_sub(2)).max(10).min(area.width);
    let h = h.min(area.height.saturating_sub(2)).max(3).min(area.height);
    Rect { x: area.x + (area.width - w) / 2, y: area.y + (area.height - h) / 2, width: w, height: h }
}

pub fn draw(f: &mut Frame, app: &mut App) {
    let area = f.area();
    if area.width < 26 || area.height < 8 {
        let msg = Paragraph::new(Line::styled(app.s.resize, app.theme.accent)).wrap(ratatui::widgets::Wrap { trim: true });
        f.render_widget(msg, area);
        return;
    }
    if matches!(app.mode, Mode::Editor(_)) {
        draw_editor(f, app, area);
    } else {
        draw_workspace(f, app, area);
    }
    let modals = std::mem::take(&mut app.modals);
    for modal in &modals {
        draw_modal(f, app, modal, area);
    }
    app.modals = modals;
}

// ---- workspace ----------------------------------------------------------------------------

fn draw_workspace(f: &mut Frame, app: &mut App, area: Rect) {
    let mode = layout_for(area.width);
    let inner_w = area.width.saturating_sub(2) as usize;
    let comp_lines: usize = app.composer.lines().iter().map(|l| (width(l).div_ceil(inner_w.max(1))).max(1)).sum::<usize>().clamp(1, 5);
    let comp_h = comp_lines as u16 + 2;
    let strip_h = if mode == Layout3::Medium { 1 } else { 0 };
    let rows = Layout::vertical([
        Constraint::Length(1),
        Constraint::Length(strip_h),
        Constraint::Min(3),
        Constraint::Length(comp_h),
        Constraint::Length(1),
    ])
    .split(area);
    app.rects = Rects::default();
    draw_header(f, app, rows[0]);
    if strip_h > 0 {
        draw_people_strip(f, app, rows[1]);
    }
    let body = rows[2];
    match mode {
        Layout3::Wide => {
            let doc_w = (body.width * 38 / 100).max(40);
            let cols = Layout::horizontal([Constraint::Length(24), Constraint::Min(30), Constraint::Length(doc_w)]).split(body);
            draw_people(f, app, cols[0]);
            draw_chat(f, app, cols[1]);
            draw_doc(f, app, cols[2]);
        }
        Layout3::Medium => {
            let doc_w = (body.width * 40 / 100).max(32);
            let cols = Layout::horizontal([Constraint::Min(30), Constraint::Length(doc_w)]).split(body);
            draw_chat(f, app, cols[0]);
            draw_doc(f, app, cols[1]);
        }
        Layout3::Tabs => {
            let parts = Layout::vertical([Constraint::Length(1), Constraint::Min(2)]).split(body);
            draw_tabs(f, app, parts[0]);
            match app.tab {
                Tab::Chat => draw_chat(f, app, parts[1]),
                Tab::Doc => draw_doc(f, app, parts[1]),
                Tab::People => draw_people(f, app, parts[1]),
            }
        }
    }
    draw_composer(f, app, rows[3]);
    draw_mention_popup(f, app, rows[3]);
    draw_footer(f, app, rows[4]);
}

fn draw_header(f: &mut Frame, app: &mut App, area: Rect) {
    let th = &app.theme;
    let sym = th.sym();
    let s = app.s;
    let (dot, dot_style, label) = match &app.state.conn {
        Conn::Connecting => (sym.offline, th.warn, s.connecting.to_string()),
        Conn::Live(Transport::Sse) => (sym.online, th.ok, s.live_sse.to_string()),
        Conn::Live(Transport::Poll) => (sym.online, th.ok, s.live_poll.to_string()),
        Conn::Reconnecting { in_secs, .. } => (sym.offline, th.warn, fmt(s.reconnecting, &[("n", &in_secs.to_string())])),
        Conn::Ended(reason) => (sym.cross, th.err, fmt(s.ended, &[("reason", &text::clip(reason, 40, sym.ellipsis))])),
    };
    let link_text = clip(&app.link(), (area.width as usize).saturating_sub(48).max(12), sym.ellipsis);
    let link_rect = Rect { x: area.x + 4, y: area.y, width: (width(&link_text) as u16).min(area.width.saturating_sub(4)), height: 1 };
    let online = app.state.participants.len();
    let mut spans = vec![
        Span::styled(" 4w ", th.brand),
        Span::styled(link_text, th.accent.add_modifier(Modifier::UNDERLINED)),
        Span::raw("  "),
        Span::styled(dot, dot_style),
        Span::raw(" "),
        Span::styled(label, th.dim),
    ];
    if online > 0 && area.width >= 60 {
        spans.push(Span::styled(format!("  {}", fmt(s.online, &[("n", &online.to_string())])), th.dim));
    }
    if let (Some(expires), true) = (app.state.expires_at, area.width >= 80) {
        let now = fw_core::config::now_ms();
        let text = if expires > now { fmt(s.expires, &[("t", &duration_short((expires - now) / 1000))]) } else { s.expired.to_string() };
        spans.push(Span::styled(format!("  {text}"), th.dim));
    }
    if app.is_owner() {
        spans.push(Span::styled(format!("  [{}]", s.owner), th.warn));
    }
    spans.push(Span::styled(format!("  [{}]", app.lang.code().to_uppercase()), th.dim));
    f.render_widget(Paragraph::new(Line::from(spans)), area);
    app.rects.link = link_rect;
}

fn participant_badge(app: &App, p: &Participant) -> Vec<Span<'static>> {
    let th = &app.theme;
    let mut spans = Vec::new();
    if p.role == Role::Llm {
        spans.push(Span::styled(format!(" [{}]", app.s.agent), th.brand));
    }
    if p.status.as_deref() == Some("working") {
        spans.push(Span::styled(format!(" {}", app.s.working), th.warn));
    }
    spans
}

fn presence_dot(app: &App, p: &Participant) -> (&'static str, Style) {
    let sym = app.theme.sym();
    if p.status.as_deref() == Some("working") { (sym.busy, app.theme.warn) } else { (sym.online, app.theme.ok) }
}

fn draw_people_strip(f: &mut Frame, app: &App, area: Rect) {
    let th = &app.theme;
    let mut spans = vec![Span::raw(" ")];
    let mut used = 1usize;
    let people = app.state.sorted_participants();
    for (i, p) in people.iter().enumerate() {
        let (dot, dot_style) = presence_dot(app, p);
        let name = if p.nick == app.state.my_nick { format!("{} ({})", p.nick, app.s.you) } else { p.nick.clone() };
        let chunk_w = width(&name) + 3 + if p.role == Role::Llm { 5 } else { 0 };
        if used + chunk_w + 8 > area.width as usize {
            spans.push(Span::styled(fmt(app.s.more_people, &[("n", &(people.len() - i).to_string())]), th.dim));
            break;
        }
        spans.push(Span::styled(dot, dot_style));
        spans.push(Span::raw(" "));
        spans.push(Span::styled(name, th.nick_style(&p.nick)));
        spans.extend(participant_badge(app, p));
        spans.push(Span::raw("  "));
        used += chunk_w;
    }
    f.render_widget(Paragraph::new(Line::from(spans)), area);
}

fn draw_tabs(f: &mut Frame, app: &mut App, area: Rect) {
    let th = app.theme.clone();
    let items = [(Tab::Chat, app.s.chat), (Tab::Doc, app.s.doc), (Tab::People, app.s.people)];
    let mut x = area.x;
    let mut spans = Vec::new();
    for (tab, label) in items {
        let text = format!(" {label} ");
        let w = width(&text) as u16;
        let style = if app.tab == tab { th.selected } else { th.dim };
        spans.push(Span::styled(text, style));
        spans.push(Span::raw(" "));
        app.rects.tabs.push((Rect { x, y: area.y, width: w, height: 1 }, tab));
        x += w + 1;
    }
    f.render_widget(Paragraph::new(Line::from(spans)), area);
}

// ---- chat ------------------------------------------------------------------------------------

fn build_chat(app: &App, w: usize) -> (Vec<Line<'static>>, Vec<(usize, usize)>) {
    let th = &app.theme;
    let sym = th.sym();
    let compact = w < 40;
    let indent = if compact { 2 } else { 8 };
    let mut lines: Vec<Line<'static>> = Vec::new();
    let mut spans_out = Vec::with_capacity(app.state.messages.len());
    let mut prev: Option<(&str, u64, i32)> = None;
    let mut rule_before = false;
    for m in app.state.messages.iter() {
        if app.first_unread_seq == Some(m.seq) {
            let label = format!(" {} ", app.s.unread_rule);
            let side = w.saturating_sub(width(&label)) / 2;
            lines.push(Line::from(Span::styled(
                format!("{}{label}{}", sym.rule.repeat(side), sym.rule.repeat(w.saturating_sub(side + width(&label)))),
                th.warn,
            )));
            rule_before = true;
        }
        let day = day_of(m.ts);
        let new_day = prev.map(|(_, _, d)| d != day).unwrap_or(m.ts > 0);
        if new_day && m.ts > 0 {
            let label = format!(" {} ", day_label(m.ts));
            let side = w.saturating_sub(width(&label)) / 2;
            lines.push(Line::from(Span::styled(
                format!("{}{label}{}", sym.rule.repeat(side), sym.rule.repeat(w.saturating_sub(side + width(&label)))),
                th.dim,
            )));
        }
        let group_start =
            new_day || rule_before || prev.map(|(n, t, _)| n != m.nick || m.ts.saturating_sub(t) > 5 * 60 * 1000).unwrap_or(true);
        rule_before = false;
        let mine = app.my_message(m);
        let mention = !mine && fw_room::mentions(&m.text, &app.state.my_nick, Role::Human);
        let bar = if mention { Span::styled(sym.bar, th.mention) } else { Span::raw(" ") };
        let start = lines.len();
        if group_start {
            let nick_style = if mine { th.accent } else { th.nick_style(&m.nick) };
            let name = if mine { format!("{} ({})", m.nick, app.s.you) } else { m.nick.clone() };
            let mut head = vec![bar.clone()];
            if !compact {
                head.push(Span::styled(format!("{} ", clock(m.ts)), th.dim));
                head.push(Span::raw(" "));
            } else {
                head.push(Span::raw(" "));
            }
            head.push(Span::styled(clip(&name, w.saturating_sub(indent + 6), sym.ellipsis), nick_style));
            if m.role == Role::Llm {
                head.push(Span::styled(format!(" [{}]", app.s.agent), th.brand));
            }
            lines.push(Line::from(head));
        }
        let body = if app.reveal { m.text.clone() } else { fw_core::sanitize::mask_secrets(&m.text, app.lang) };
        for row in wrap(&body, w.saturating_sub(indent)) {
            let row_style = if mention { th.text.add_modifier(Modifier::BOLD) } else { th.text };
            lines.push(Line::from(vec![bar.clone(), Span::raw(" ".repeat(indent - 1)), Span::styled(row, row_style)]));
        }
        if let Some(url) = &m.file_url {
            let name = m.filename.clone().unwrap_or_else(|| crate::util::file_name_from_url(url));
            let shown = if app.reveal { url.clone() } else { fw_core::sanitize::mask_secrets(url, app.lang) };
            let line = format!("[{}] {name}  {} {shown}", app.s.file_label, sym.arrow);
            lines.push(Line::from(vec![
                Span::raw(" ".repeat(indent)),
                Span::styled(clip(&line, w.saturating_sub(indent), sym.ellipsis), th.ok),
            ]));
        }
        spans_out.push((start, lines.len() - start));
        prev = Some((m.nick.as_str(), m.ts, day));
    }
    (lines, spans_out)
}

fn chat_key(app: &App, w: usize) -> (usize, usize, bool, fw_core::Lang, usize, Option<u64>) {
    (
        w,
        app.state.messages.len(),
        app.reveal,
        app.lang,
        app.theme.name as usize + if app.theme.unicode { 10 } else { 0 },
        app.first_unread_seq,
    )
}

fn draw_chat(f: &mut Frame, app: &mut App, area: Rect) {
    app.rects.chat = area;
    let focused = matches!(app.focus, Pane::Chat | Pane::Input) && matches!(app.tab, Tab::Chat);
    let block = pane_block(app, title_line(app, app.s.chat.to_string(), focused), focused);
    let inner = block.inner(area);
    f.render_widget(block, area);
    let w = (inner.width as usize).saturating_sub(1).max(8);
    app.chat_width = w;
    let key = chat_key(app, w);
    if app.chat_cache.as_ref().map(|c| c.key != key).unwrap_or(true) {
        let (lines, spans) = build_chat(app, w);
        app.chat_cache = Some(ChatCache { key, lines, spans });
    }
    let h = inner.height as usize;
    let mut lines: Vec<Line<'static>> = app.chat_cache.as_ref().map(|c| c.lines.clone()).unwrap_or_default();
    // highlight the selected message
    if let (Some(sel), Some(cache)) = (app.chat_sel, app.chat_cache.as_ref())
        && let Some(&(start, len)) = cache.spans.get(sel)
    {
        for line in lines.iter_mut().skip(start).take(len) {
            for span in &mut line.spans {
                span.style = span.style.patch(Style::default().add_modifier(Modifier::REVERSED));
            }
        }
    }
    // optimistic messages not yet echoed by the server
    let th = app.theme.clone();
    for p in &app.pending {
        let (label, style) = match &p.state {
            SendState::Sending => (app.s.sending.to_string(), th.dim),
            SendState::Sent(_) => (String::new(), th.dim),
            SendState::Failed(reason) => (format!("{} ({})", app.s.send_failed, clip(reason, 40, "…")), th.err),
        };
        let body = wrap(&p.text, w.saturating_sub(8));
        for (i, row) in body.iter().enumerate() {
            let mut spans = vec![
                Span::raw(" "),
                Span::styled(if i == 0 { format!("{} ", clock(p.ts_ms)) } else { "      ".into() }, th.dim),
                Span::raw(" "),
                Span::styled(row.clone(), style),
            ];
            if i + 1 == body.len() && !label.is_empty() {
                spans.push(Span::styled(format!("  {label}"), style));
            }
            lines.push(Line::from(spans));
        }
    }
    let total = lines.len();
    let scroll = app.chat_scroll.min(total.saturating_sub(1));
    let end = total.saturating_sub(scroll);
    let start = end.saturating_sub(h);
    let mut visible: Vec<Line<'static>> = lines[start..end].to_vec();
    if app.state.messages.is_empty() && app.pending.is_empty() {
        visible = vec![Line::styled(app.s.no_messages, th.dim)];
    }
    let pad = h.saturating_sub(visible.len());
    let text_area = Rect { x: inner.x, y: inner.y + pad as u16, width: inner.width.saturating_sub(1), height: inner.height - pad as u16 };
    f.render_widget(Paragraph::new(visible), text_area);
    if total > h {
        let mut state = ScrollbarState::new(total.saturating_sub(h)).position(start);
        f.render_stateful_widget(
            Scrollbar::new(ScrollbarOrientation::VerticalRight).begin_symbol(None).end_symbol(None),
            inner,
            &mut state,
        );
    }
    if scroll > 0 && app.unread > 0 {
        let label = format!(" {} {} ", app.theme.sym().down, fmt(app.s.new_below, &[("n", &app.unread.to_string())]));
        let w = width(&label) as u16;
        if inner.width > w + 2 {
            let r =
                Rect { x: inner.x + inner.width.saturating_sub(w + 2), y: inner.y + inner.height.saturating_sub(1), width: w, height: 1 };
            f.render_widget(Paragraph::new(Line::styled(label, th.selected)), r);
        }
    }
}

// ---- people ----------------------------------------------------------------------------------

fn draw_people(f: &mut Frame, app: &mut App, area: Rect) {
    app.rects.people = area;
    let focused = app.focus == Pane::People;
    let title = format!("{} ({})", app.s.people, app.state.participants.len());
    let block = pane_block(app, title_line(app, title, focused), focused);
    let inner = block.inner(area);
    f.render_widget(block, area);
    let th = app.theme.clone();
    let mut rows = Vec::new();
    let people = app.state.sorted_participants();
    for (i, p) in people.iter().enumerate() {
        if i as u16 >= inner.height {
            break;
        }
        let (dot, dot_style) = presence_dot(app, p);
        let me = p.nick == app.state.my_nick;
        let name = if me { format!("{} ({})", p.nick, app.s.you) } else { p.nick.clone() };
        let mut spans =
            vec![Span::styled(format!(" {dot} "), dot_style), Span::styled(name, if me { th.accent } else { th.nick_style(&p.nick) })];
        spans.extend(participant_badge(app, p));
        let mut line = Line::from(spans);
        if focused && app.people_sel == i {
            line = line.patch_style(th.selected);
        }
        rows.push(line);
        app.rects.people_rows.push((Rect { x: inner.x, y: inner.y + i as u16, width: inner.width, height: 1 }, i));
    }
    f.render_widget(Paragraph::new(rows), inner);
}

// ---- document --------------------------------------------------------------------------------

fn draw_doc(f: &mut Frame, app: &mut App, area: Rect) {
    app.rects.doc = area;
    let focused = app.focus == Pane::Doc;
    let mut title = app.s.doc.to_string();
    if app.state.doc_loaded {
        title.push_str(&format!(" · {}", fmt(app.s.rev, &[("v", &app.state.doc.version.to_string())])));
        if let Some(editor) = &app.state.doc.editor {
            title.push_str(&format!(" · {editor}"));
        }
    }
    let block = pane_block(app, title_line(app, title, focused), focused);
    let inner = block.inner(area);
    f.render_widget(block, area);
    let w = (inner.width as usize).saturating_sub(2).max(8);
    let key = (w, app.state.doc.version, app.state.doc.updated_at, app.reveal, format!("{:?}{}", app.theme.name, app.theme.unicode));
    if app.doc_cache.as_ref().map(|c| c.key != key).unwrap_or(true) {
        let content =
            if app.reveal { app.state.doc.content.clone() } else { fw_core::sanitize::mask_secrets(&app.state.doc.content, app.lang) };
        let lines = markdown::render(&content, w, &app.theme);
        app.doc_cache = Some(DocCache { key, lines });
    }
    let h = inner.height as usize;
    let lines = app.doc_cache.as_ref().map(|c| c.lines.clone()).unwrap_or_default();
    if lines.is_empty() {
        let msg = if app.state.doc_loaded { app.s.doc_empty } else { app.s.doc_loading };
        f.render_widget(Paragraph::new(Line::styled(msg, app.theme.dim)).wrap(ratatui::widgets::Wrap { trim: true }), inner);
        return;
    }
    let max_scroll = lines.len().saturating_sub(h);
    app.doc_scroll = app.doc_scroll.min(max_scroll);
    let visible: Vec<Line<'static>> = lines.iter().skip(app.doc_scroll).take(h).cloned().collect();
    let text_area = Rect { x: inner.x + 1, y: inner.y, width: inner.width.saturating_sub(2), height: inner.height };
    f.render_widget(Paragraph::new(visible), text_area);
    if lines.len() > h {
        let mut state = ScrollbarState::new(max_scroll).position(app.doc_scroll);
        f.render_stateful_widget(
            Scrollbar::new(ScrollbarOrientation::VerticalRight).begin_symbol(None).end_symbol(None),
            inner,
            &mut state,
        );
    }
}

// ---- composer & footer ---------------------------------------------------------------------------

fn draw_composer(f: &mut Frame, app: &mut App, area: Rect) {
    app.rects.composer = area;
    let focused = app.focus == Pane::Input;
    let n = app.composer_len();
    let over = n > MAX_MESSAGE;
    let label = fmt(app.s.composer_title, &[("n", &n.to_string()), ("max", &MAX_MESSAGE.to_string())]);
    let mut block = pane_block(app, title_line(app, label, focused), focused);
    if over {
        block = block.border_style(app.theme.err);
    }
    let inner = block.inner(area);
    f.render_widget(block, area);
    let cursor = if focused { Style::default().add_modifier(Modifier::REVERSED) } else { Style::default() };
    app.composer.set_cursor_style(cursor);
    f.render_widget(&app.composer, inner);
}

fn draw_mention_popup(f: &mut Frame, app: &App, composer: Rect) {
    if app.focus != Pane::Input {
        return;
    }
    let (_, names) = app.mention_candidates();
    if names.is_empty() {
        return;
    }
    let shown: Vec<&String> = names.iter().take(6).collect();
    let w = (shown.iter().map(|n| width(n)).max().unwrap_or(4) + 6) as u16;
    let h = shown.len() as u16 + 2;
    if composer.y < h + 1 {
        return;
    }
    let rect = Rect { x: composer.x + 2, y: composer.y - h, width: w.min(composer.width), height: h };
    f.render_widget(Clear, rect);
    let lines: Vec<Line> = shown
        .iter()
        .enumerate()
        .map(|(i, n)| {
            let style = if i == app.mention_sel.min(shown.len() - 1) { app.theme.selected } else { app.theme.nick_style(n) };
            Line::styled(format!(" @{n} "), style)
        })
        .collect();
    f.render_widget(Paragraph::new(lines).block(pane_block(app, Line::default(), true)), rect);
}

fn draw_footer(f: &mut Frame, app: &App, area: Rect) {
    let s = app.s;
    // The newest notification takes over the status line (no overlays on top of the panes).
    if let Some(toast) = app.toasts.back() {
        let style = match toast.kind {
            ToastKind::Info => app.theme.accent,
            ToastKind::Ok => app.theme.ok,
            ToastKind::Warn => app.theme.warn,
            ToastKind::Err => app.theme.err,
        };
        f.render_widget(
            Paragraph::new(Line::styled(
                format!(" {}", clip(&toast.text, (area.width as usize).saturating_sub(1), "…")),
                style.add_modifier(Modifier::BOLD),
            )),
            area,
        );
        return;
    }
    let text = if !app.modals.is_empty() {
        s.foot_modal
    } else if matches!(app.mode, Mode::Editor(_)) {
        s.foot_editor
    } else if area.width < 60 {
        s.foot_tiny
    } else {
        match app.focus {
            Pane::None => s.foot_none,
            Pane::Input => s.foot_input,
            Pane::Chat => s.foot_chat,
            Pane::Doc => s.foot_doc,
            Pane::People => s.foot_people,
        }
    };
    f.render_widget(
        Paragraph::new(Line::styled(format!(" {}", clip(text, (area.width as usize).saturating_sub(1), "…")), app.theme.dim)),
        area,
    );
}

// ---- editor ----------------------------------------------------------------------------------

fn draw_editor(f: &mut Frame, app: &mut App, area: Rect) {
    let th = app.theme.clone();
    let s = app.s;
    let (loaded, saving, dirty, preview, base_version, remote, error, count) = match &app.mode {
        Mode::Editor(e) => (
            e.loaded,
            e.saving,
            editor_dirty(e),
            e.preview,
            e.base_version,
            e.remote.clone(),
            e.error.clone(),
            e.ta.lines().iter().map(|l| l.chars().count()).sum::<usize>() + e.ta.lines().len().saturating_sub(1),
        ),
        Mode::Workspace => return,
    };
    let state = if saving {
        s.editor_busy
    } else if dirty {
        s.editor_dirty
    } else {
        s.editor_clean
    };
    let counter = fmt(s.editor_count, &[("n", &count.to_string()), ("max", &MAX_DOC.to_string())]);
    let title = format!("{} · {} · {state} · {counter}", s.editor_title, fmt(s.rev, &[("v", &base_version.to_string())]));
    let rows = Layout::vertical([Constraint::Min(3), Constraint::Length(1)]).split(area);
    let mut block = pane_block(app, title_line(app, title, true), true);
    if count > MAX_DOC {
        block = block.border_style(th.err);
    }
    let inner = block.inner(rows[0]);
    f.render_widget(block, rows[0]);
    let mut body = inner;
    let mut banner_lines: Vec<Line> = Vec::new();
    if let Some(r) = &remote {
        banner_lines.push(Line::styled(format!(" {}", fmt(s.editor_banner, &[("who", &r.who), ("v", &r.version.to_string())])), th.warn));
    }
    if let Some(e) = &error {
        banner_lines.push(Line::styled(format!(" {}", clip(e, (inner.width as usize).saturating_sub(2), "…")), th.err));
    }
    if !banner_lines.is_empty() && inner.height > 3 {
        let h = banner_lines.len() as u16;
        f.render_widget(Paragraph::new(banner_lines), Rect { x: inner.x, y: inner.y, width: inner.width, height: h });
        body = Rect { x: inner.x, y: inner.y + h, width: inner.width, height: inner.height.saturating_sub(h) };
    }
    if !loaded {
        let spin = th.sym().spinner[app.spinner % th.sym().spinner.len()];
        f.render_widget(Paragraph::new(Line::styled(format!(" {spin} {}", s.doc_loading), th.dim)), body);
    } else if let Mode::Editor(editor) = &mut app.mode {
        if preview && body.width >= 70 {
            let cols = Layout::horizontal([Constraint::Percentage(50), Constraint::Percentage(50)]).split(body);
            f.render_widget(&editor.ta, cols[0]);
            let pb = Block::new().borders(Borders::LEFT).border_style(th.border).title(title_line_static(&th, s.preview));
            let pi = pb.inner(cols[1]);
            f.render_widget(pb, cols[1]);
            let md = editor.ta.lines().join("\n");
            let lines = markdown::render(&md, pi.width.saturating_sub(2) as usize, &th);
            f.render_widget(Paragraph::new(lines), Rect { x: pi.x + 1, y: pi.y, width: pi.width.saturating_sub(1), height: pi.height });
        } else {
            f.render_widget(&editor.ta, body);
        }
    }
    draw_footer(f, app, rows[1]);
}

fn title_line_static<'a>(th: &crate::theme::Theme, label: &str) -> Line<'a> {
    Line::from(vec![Span::raw(" "), Span::styled(label.to_string(), th.dim), Span::raw(" ")])
}

// ---- modals ----------------------------------------------------------------------------------

fn input_line(input: &LineInput, th: &crate::theme::Theme, focused: bool) -> Line<'static> {
    let chars: Vec<char> = input.text.chars().collect();
    let before: String = chars.iter().take(input.cursor).collect();
    let at: String = chars.get(input.cursor).map(|c| c.to_string()).unwrap_or_else(|| " ".into());
    let after: String = chars.iter().skip(input.cursor + 1).collect();
    let cursor_style = if focused { Style::default().add_modifier(Modifier::REVERSED) } else { Style::default() };
    Line::from(vec![Span::styled("› ", th.accent), Span::raw(before), Span::styled(at, cursor_style), Span::raw(after)])
}

fn modal_block<'a>(app: &App, title: &str) -> Block<'a> {
    pane_block(app, title_line(app, title.to_string(), true), true)
}

fn draw_modal(f: &mut Frame, app: &App, modal: &Modal, area: Rect) {
    let th = &app.theme;
    let s = app.s;
    match modal {
        Modal::Help { scroll } => {
            let rect = centered(area, 78, s.help_rows.len() as u16 + 4);
            f.render_widget(Clear, rect);
            let block = modal_block(app, s.help_title);
            let inner = block.inner(rect);
            f.render_widget(block, rect);
            let key_w = 22usize.min(inner.width as usize / 3);
            let mut lines: Vec<Line> = Vec::new();
            for (keys, what) in s.help_rows {
                let wrapped = wrap(what, (inner.width as usize).saturating_sub(key_w + 2).max(10));
                let key_text = clip(keys, key_w, "…");
                for (i, row) in wrapped.iter().enumerate() {
                    let k = if i == 0 { key_text.clone() } else { String::new() };
                    lines.push(Line::from(vec![Span::styled(format!("{k:<key_w$}"), th.accent), Span::raw("  "), Span::raw(row.clone())]));
                }
            }
            let max = lines.len().saturating_sub(inner.height as usize);
            let top = (*scroll).min(max);
            f.render_widget(Paragraph::new(lines.into_iter().skip(top).collect::<Vec<_>>()), inner);
        }
        Modal::Palette { filter, selected } => {
            let list = app.palette_list(&filter.text);
            let rect = centered(area, 58, (list.len().max(1) as u16 + 5).min(area.height.saturating_sub(2)));
            f.render_widget(Clear, rect);
            let block = modal_block(app, s.palette_title);
            let inner = block.inner(rect);
            f.render_widget(block, rect);
            let rows = Layout::vertical([Constraint::Length(1), Constraint::Length(1), Constraint::Min(1)]).split(inner);
            f.render_widget(Paragraph::new(input_line(filter, th, true)), rows[0]);
            f.render_widget(Paragraph::new(Line::styled(s.palette_hint, th.dim)), rows[1]);
            let sel = (*selected).min(list.len().saturating_sub(1));
            let mut lines: Vec<Line> = list
                .iter()
                .enumerate()
                .map(|(i, c)| {
                    let style = if i == sel { th.selected } else { th.text };
                    Line::styled(format!(" {} ", app.cmd_label(*c)), style)
                })
                .collect();
            if lines.is_empty() {
                lines.push(Line::styled(s.no_results, th.dim));
            }
            let h = rows[2].height as usize;
            let skip = sel.saturating_sub(h.saturating_sub(1));
            f.render_widget(Paragraph::new(lines.into_iter().skip(skip).collect::<Vec<_>>()), rows[2]);
        }
        Modal::Share { selected } => {
            let rect = centered(area, 76, 12);
            f.render_widget(Clear, rect);
            let block = modal_block(app, s.share_title);
            let inner = block.inner(rect);
            f.render_widget(block, rect);
            let secret = |v: &Option<String>| match v {
                Some(k) if app.reveal => k.clone(),
                Some(_) => "••••••••••••••••".replace('•', if th.unicode { "•" } else { "*" }),
                None => s.share_missing.to_string(),
            };
            let rows = [(s.share_link, Some(app.link())), (s.share_llm, app.llm_key.clone()), (s.share_admin, app.owner_admin_key.clone())];
            let mut lines: Vec<Line> = Vec::new();
            for (i, (label, value)) in rows.iter().enumerate() {
                let shown = if i == 0 { value.clone().unwrap_or_default() } else { secret(value) };
                let style = if i == *selected { th.selected } else { th.text };
                lines.push(Line::styled(format!(" {label}"), th.dim));
                lines.push(Line::styled(format!(" {}", clip(&shown, (inner.width as usize).saturating_sub(2), "…")), style));
                lines.push(Line::default());
            }
            lines.push(Line::styled(s.share_hint, th.dim));
            f.render_widget(Paragraph::new(lines), inner);
        }
        Modal::History { selected, diff_scroll } => draw_history(f, app, area, *selected, *diff_scroll),
        Modal::Diff { title, lines, scroll } => {
            let rect = centered(area, area.width * 9 / 10, area.height * 85 / 100);
            f.render_widget(Clear, rect);
            let block = modal_block(app, title);
            let inner = block.inner(rect);
            f.render_widget(block, rect);
            f.render_widget(Paragraph::new(diff_lines(app, lines, inner.width as usize, *scroll, inner.height as usize)), inner);
        }
        Modal::Conflict { who, mine, theirs, .. } => {
            let rect = centered(area, 76, 11);
            f.render_widget(Clear, rect);
            let block = modal_block(app, s.conflict_title).border_style(th.warn);
            let inner = block.inner(rect);
            f.render_widget(block, rect);
            let (a, d) = crate::diff::stats(theirs, mine);
            let mut lines = vec![Line::styled(fmt(s.conflict_body, &[("who", who)]), th.warn), Line::default()];
            lines.push(Line::from(vec![
                Span::styled(format!(" +{a} "), th.diff_add),
                Span::styled(format!("−{d}"), th.diff_del),
                Span::styled("  (D: diff)", th.dim),
            ]));
            lines.push(Line::default());
            for row in wrap(s.conflict_opts, (inner.width as usize).saturating_sub(2)) {
                lines.push(Line::styled(format!(" {row}"), th.accent));
            }
            f.render_widget(Paragraph::new(lines), inner);
        }
        Modal::Confirm { text, kind } => {
            let title = match kind {
                ConfirmKind::Quit => s.quit_title,
                ConfirmKind::DiscardEditor => s.discard_title,
                _ => s.confirm_title,
            };
            let rect = centered(area, 60, 7);
            f.render_widget(Clear, rect);
            let block = modal_block(app, title);
            let inner = block.inner(rect);
            f.render_widget(block, rect);
            let mut lines: Vec<Line> =
                wrap(text, (inner.width as usize).saturating_sub(2)).into_iter().map(|r| Line::raw(format!(" {r}"))).collect();
            lines.push(Line::default());
            lines.push(Line::styled(format!(" {}", s.confirm_hint), th.accent));
            f.render_widget(Paragraph::new(lines), inner);
        }
        Modal::FilePrompt { input, burn, error, completions, comp_idx } => {
            let extra = completions.len().min(6) as u16;
            let rect = centered(area, 72, 9 + extra);
            f.render_widget(Clear, rect);
            let block = modal_block(app, s.file_title);
            let inner = block.inner(rect);
            f.render_widget(block, rect);
            let mut lines = vec![Line::styled(s.file_hint, th.dim), input_line(input, th, true), Line::default()];
            let check = if *burn { "[x]" } else { "[ ]" };
            lines.push(Line::styled(format!(" {check} {}  (Ctrl+B)", s.file_burn), th.text));
            if let Some(e) = error {
                lines.push(Line::styled(format!(" {e}"), th.err));
            }
            for (i, c) in completions.iter().take(6).enumerate() {
                let style = if i == *comp_idx { th.selected } else { th.dim };
                lines.push(Line::styled(format!("  {}", clip(c, (inner.width as usize).saturating_sub(4), "…")), style));
            }
            f.render_widget(Paragraph::new(lines), inner);
        }
        Modal::Files { selected } => {
            let files = app.file_messages();
            let rect = centered(area, 80, (files.len().max(1) as u16 + 5).min(area.height.saturating_sub(2)));
            f.render_widget(Clear, rect);
            let block = modal_block(app, s.files_title);
            let inner = block.inner(rect);
            f.render_widget(block, rect);
            let mut lines: Vec<Line> = Vec::new();
            if files.is_empty() {
                lines.push(Line::styled(s.files_empty, th.dim));
            }
            for (i, idx) in files.iter().enumerate() {
                let Some(m) = app.state.messages.get(*idx) else { continue };
                let name = m.filename.clone().unwrap_or_else(|| crate::util::file_name_from_url(m.file_url.as_deref().unwrap_or("")));
                let style = if i == *selected { th.selected } else { th.text };
                lines.push(Line::styled(
                    format!(
                        " {}  {}  {}",
                        clock(m.ts),
                        clip(&m.nick, 16, "…"),
                        clip(&name, (inner.width as usize).saturating_sub(30), "…")
                    ),
                    style,
                ));
            }
            lines.push(Line::default());
            lines.push(Line::styled(s.files_hint, th.dim));
            f.render_widget(Paragraph::new(lines), inner);
        }
        Modal::Download { url, input, burn_note } => {
            let rect = centered(area, 78, 9);
            f.render_widget(Clear, rect);
            let block = modal_block(app, s.download_to);
            let inner = block.inner(rect);
            f.render_widget(block, rect);
            let mut lines = vec![
                Line::styled(clip(&fw_core::sanitize::mask_secrets(url, app.lang), (inner.width as usize).saturating_sub(2), "…"), th.dim),
                input_line(input, th, true),
                Line::default(),
            ];
            if *burn_note {
                lines.push(Line::styled(" ! burn-after-reading files can be downloaded only once", th.warn));
            }
            f.render_widget(Paragraph::new(lines), inner);
        }
        Modal::Moderation { person, ban, in_bans, bans, .. } => draw_moderation(f, app, area, *person, *ban, *in_bans, bans),
        Modal::Actions { index, selected } => {
            let has_file = app.state.messages.get(*index).is_some_and(|m| m.file_url.is_some());
            let mut items = vec![s.act_copy, s.act_reply];
            if has_file {
                items.push(s.act_copy_link);
            }
            let rect = centered(area, 40, items.len() as u16 + 4);
            f.render_widget(Clear, rect);
            let block = modal_block(app, s.actions_title);
            let inner = block.inner(rect);
            f.render_widget(block, rect);
            let lines: Vec<Line> = items
                .iter()
                .enumerate()
                .map(|(i, t)| Line::styled(format!(" {t} "), if i == *selected { th.selected } else { th.text }))
                .collect();
            f.render_widget(Paragraph::new(lines), inner);
        }
        Modal::Search { query, selected } => {
            let results = app.search_results(&query.text);
            let rect = centered(area, 76, (results.len().min(10) as u16 + 5).max(7));
            f.render_widget(Clear, rect);
            let block = modal_block(app, s.search_title);
            let inner = block.inner(rect);
            f.render_widget(block, rect);
            let mut lines = vec![input_line(query, th, true), Line::default()];
            if results.is_empty() && !query.text.is_empty() {
                lines.push(Line::styled(s.search_none, th.dim));
            }
            let sel = (*selected).min(results.len().saturating_sub(1));
            for (i, idx) in results.iter().take(10).enumerate() {
                let Some(m) = app.state.messages.get(*idx) else { continue };
                let preview = m.text.replace('\n', " ");
                let style = if i == sel { th.selected } else { th.text };
                lines.push(Line::styled(
                    format!(
                        " {} {}: {}",
                        clock(m.ts),
                        m.nick,
                        clip(&preview, (inner.width as usize).saturating_sub(16 + width(&m.nick)), "…")
                    ),
                    style,
                ));
            }
            f.render_widget(Paragraph::new(lines), inner);
        }
        Modal::Text { title, body } => {
            let rect = centered(area, 80, 9);
            f.render_widget(Clear, rect);
            let block = modal_block(app, title);
            let inner = block.inner(rect);
            f.render_widget(block, rect);
            let lines: Vec<Line> =
                wrap(&app.mask(body), (inner.width as usize).saturating_sub(2)).into_iter().map(|r| Line::raw(format!(" {r}"))).collect();
            f.render_widget(Paragraph::new(lines), inner);
        }
        Modal::Upload(u) => {
            let rect = centered(area, 60, 6);
            f.render_widget(Clear, rect);
            let block = modal_block(app, &fmt(s.uploading, &[("name", &u.name)]));
            let inner = block.inner(rect);
            f.render_widget(block, rect);
            let ratio =
                if u.total > 0 { (u.sent.load(std::sync::atomic::Ordering::Relaxed) as f64 / u.total as f64).clamp(0.0, 1.0) } else { 0.0 };
            let spin = th.sym().spinner[app.spinner % th.sym().spinner.len()];
            f.render_widget(Paragraph::new(Line::styled(format!(" {spin}"), th.accent)), Rect { height: 1, ..inner });
            f.render_widget(
                Gauge::default().gauge_style(th.accent).ratio(ratio).label(format!("{:.0}%", ratio * 100.0)),
                Rect { y: inner.y + 2, height: 1, ..inner },
            );
        }
    }
}

fn diff_lines(app: &App, lines: &[(char, String)], w: usize, scroll: usize, h: usize) -> Vec<Line<'static>> {
    let th = &app.theme;
    lines
        .iter()
        .skip(scroll)
        .take(h)
        .map(|(tag, text)| {
            let (prefix, style) = match tag {
                '+' => ("+ ", th.diff_add),
                '-' => ("- ", th.diff_del),
                '~' => ("  ", th.dim),
                _ => ("  ", th.text),
            };
            let shown = if *tag == '~' { format!("{} {text} {}", th.sym().ellipsis, th.sym().ellipsis) } else { text.clone() };
            Line::styled(format!("{prefix}{}", clip(&app.mask(&shown), w.saturating_sub(2), "…")), style)
        })
        .collect()
}

fn draw_history(f: &mut Frame, app: &App, area: Rect, selected: usize, diff_scroll: usize) {
    let th = &app.theme;
    let s = app.s;
    let rect = centered(area, area.width * 92 / 100, area.height * 85 / 100);
    f.render_widget(Clear, rect);
    let block = modal_block(app, s.history_title);
    let inner = block.inner(rect);
    f.render_widget(block, rect);
    let revs: Vec<&fw_room::Revision> = app.state.doc.history.iter().rev().collect();
    if revs.is_empty() {
        f.render_widget(
            Paragraph::new(vec![Line::styled(s.history_empty, th.dim), Line::default(), Line::styled(s.history_hint, th.dim)]),
            inner,
        );
        return;
    }
    let rows = Layout::vertical([Constraint::Min(2), Constraint::Length(1)]).split(inner);
    let cols = Layout::horizontal([Constraint::Length(40.min(rows[0].width / 2)), Constraint::Min(10)]).split(rows[0]);
    let sel = selected.min(revs.len() - 1);
    let h = cols[0].height as usize;
    let skip = sel.saturating_sub(h.saturating_sub(1));
    let list: Vec<Line> = revs
        .iter()
        .enumerate()
        .skip(skip)
        .take(h)
        .map(|(i, r)| {
            let text = fmt(
                s.revision_line,
                &[
                    ("v", &r.version.to_string()),
                    ("nick", &clip(&r.nick, 12, "…")),
                    ("a", &r.additions.to_string()),
                    ("d", &r.deletions.to_string()),
                    ("time", &clock(r.ts)),
                ],
            );
            let mut text = clip(&text, (cols[0].width as usize).saturating_sub(1), "…");
            if r.rollback_from.is_some() {
                text.push('↺');
            }
            Line::styled(text, if i == sel { th.selected } else { th.text })
        })
        .collect();
    f.render_widget(Paragraph::new(list), cols[0]);
    let current = revs[sel];
    let previous = revs.get(sel + 1).map(|r| r.content.as_str()).unwrap_or("");
    let lines = crate::diff::unified(previous, &current.content);
    let pane = Block::new().borders(Borders::LEFT).border_style(th.border);
    let pane_inner = pane.inner(cols[1]);
    f.render_widget(pane, cols[1]);
    f.render_widget(
        Paragraph::new(diff_lines(app, &lines, (pane_inner.width as usize).saturating_sub(1), diff_scroll, pane_inner.height as usize)),
        Rect { x: pane_inner.x + 1, ..pane_inner },
    );
    f.render_widget(
        Paragraph::new(Line::styled(clip(s.history_hint, rows[1].width as usize, "…"), th.dim)).alignment(Alignment::Left),
        rows[1],
    );
}

fn draw_moderation(f: &mut Frame, app: &App, area: Rect, person: usize, ban: usize, in_bans: bool, bans: &[(String, String)]) {
    let th = &app.theme;
    let s = app.s;
    let rect = centered(area, 80, if app.is_owner() { 18 } else { 7 });
    f.render_widget(Clear, rect);
    let block = modal_block(app, s.mod_title);
    let inner = block.inner(rect);
    f.render_widget(block, rect);
    if !app.is_owner() {
        let lines: Vec<Line> = wrap(s.mod_need_key, (inner.width as usize).saturating_sub(2))
            .into_iter()
            .map(|r| Line::styled(format!(" {r}"), th.warn))
            .collect();
        f.render_widget(Paragraph::new(lines), inner);
        return;
    }
    let rows = Layout::vertical([Constraint::Min(3), Constraint::Length(1)]).split(inner);
    let cols = Layout::horizontal([Constraint::Percentage(50), Constraint::Percentage(50)]).split(rows[0]);
    let people = app.state.sorted_participants();
    let psel = person.min(people.len().saturating_sub(1));
    let mut left = vec![Line::styled(format!(" {}", s.people), if in_bans { th.dim } else { th.accent })];
    for (i, p) in people.iter().enumerate() {
        let style = if i == psel && !in_bans { th.selected } else { th.text };
        left.push(Line::styled(format!(" {}", clip(&p.nick, (cols[0].width as usize).saturating_sub(3), "…")), style));
    }
    f.render_widget(Paragraph::new(left), cols[0]);
    let bsel = ban.min(bans.len().saturating_sub(1));
    let mut right = vec![Line::styled(format!(" {}", s.mod_bans), if in_bans { th.accent } else { th.dim })];
    if bans.is_empty() {
        right.push(Line::styled(format!(" {}", s.mod_none), th.dim));
    }
    for (i, (nick, id)) in bans.iter().enumerate() {
        let style = if i == bsel && in_bans { th.selected } else { th.text };
        right.push(Line::styled(format!(" {} {}", clip(nick, 20, "…"), clip(id, 12, "…")), style));
    }
    f.render_widget(Paragraph::new(right), cols[1]);
    f.render_widget(Paragraph::new(Line::styled(clip(s.mod_hint, rows[1].width as usize, "…"), th.dim)), rows[1]);
}
