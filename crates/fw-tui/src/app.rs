//! Application state and behavior of the room workspace. No drawing happens here (see `ui.rs`);
//! everything that talks to the network is spawned and reports back through [`AppMsg`].

use crate::clip::{self, CopyResult};
use crate::i18n::{Strings, strings};
use crate::text::fmt;
use crate::theme::Theme;
use fw_core::{Lang, Result};
use fw_room::{Applied, Conn, Control, Doc, Event, Message, Participant, RoomClient, RoomState, SaveOutcome, Sent};
use ratatui::crossterm::event::{Event as CtEvent, KeyCode, KeyEvent, KeyEventKind, KeyModifiers, MouseButton, MouseEvent, MouseEventKind};
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui_textarea::{TextArea, WrapMode};
use serde_json::Value;
use std::collections::VecDeque;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tokio::sync::mpsc::UnboundedSender;

pub const MAX_MESSAGE: usize = 2000;
pub const MAX_DOC: usize = 50_000;
pub const RATE_PER_MINUTE: usize = 30;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Pane {
    Input,
    Chat,
    Doc,
    People,
}

/// Palette commands, in the order of `Strings::cmds`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Cmd {
    Help,
    Palette,
    EditDoc,
    History,
    SendFile,
    Files,
    Share,
    Moderation,
    RollNick,
    CopyLink,
    Search,
    ToggleReveal,
    CycleLang,
    CycleTheme,
    JumpEnd,
    FocusChat,
    FocusDoc,
    FocusPeople,
    Quit,
}

pub const ALL_CMDS: [Cmd; 19] = [
    Cmd::Help,
    Cmd::Palette,
    Cmd::EditDoc,
    Cmd::History,
    Cmd::SendFile,
    Cmd::Files,
    Cmd::Share,
    Cmd::Moderation,
    Cmd::RollNick,
    Cmd::CopyLink,
    Cmd::Search,
    Cmd::ToggleReveal,
    Cmd::CycleLang,
    Cmd::CycleTheme,
    Cmd::JumpEnd,
    Cmd::FocusChat,
    Cmd::FocusDoc,
    Cmd::FocusPeople,
    Cmd::Quit,
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToastKind {
    Info,
    Ok,
    Warn,
    Err,
}

#[derive(Debug, Clone)]
pub struct Toast {
    pub kind: ToastKind,
    pub text: String,
    pub until: Instant,
}

#[derive(Debug, Clone, PartialEq)]
pub enum SendState {
    Sending,
    Sent(u64),
    Failed(String),
}

#[derive(Debug, Clone)]
pub struct Pending {
    pub id: u64,
    pub text: String,
    pub state: SendState,
    pub at: Instant,
    pub ts_ms: u64,
}

/// Single-line text field used by modals (filters, paths, queries).
#[derive(Debug, Clone, Default)]
pub struct LineInput {
    pub text: String,
    pub cursor: usize,
}

impl LineInput {
    pub fn with(text: &str) -> Self {
        Self { text: text.to_string(), cursor: text.chars().count() }
    }

    fn byte(&self, chars: usize) -> usize {
        self.text.char_indices().nth(chars).map(|(i, _)| i).unwrap_or(self.text.len())
    }

    pub fn insert(&mut self, c: char) {
        let at = self.byte(self.cursor);
        self.text.insert(at, c);
        self.cursor += 1;
    }

    pub fn insert_str(&mut self, s: &str) {
        for c in s.chars().filter(|c| !c.is_control()) {
            self.insert(c);
        }
    }

    /// Returns true when the key edited the text.
    pub fn key(&mut self, key: &KeyEvent) -> bool {
        let ctrl = key.modifiers.contains(KeyModifiers::CONTROL);
        match key.code {
            KeyCode::Char('u') if ctrl => {
                self.text.clear();
                self.cursor = 0;
            }
            KeyCode::Char('w') if ctrl => {
                let before: Vec<char> = self.text.chars().take(self.cursor).collect();
                let mut end = before.len();
                while end > 0 && before[end - 1] == ' ' {
                    end -= 1;
                }
                while end > 0 && before[end - 1] != ' ' {
                    end -= 1;
                }
                let tail: String = self.text.chars().skip(self.cursor).collect();
                self.text = before[..end].iter().collect::<String>() + &tail;
                self.cursor = end;
            }
            KeyCode::Char(c) if !ctrl && !key.modifiers.contains(KeyModifiers::ALT) => self.insert(c),
            KeyCode::Backspace => {
                if self.cursor > 0 {
                    let from = self.byte(self.cursor - 1);
                    let to = self.byte(self.cursor);
                    self.text.replace_range(from..to, "");
                    self.cursor -= 1;
                }
            }
            KeyCode::Delete => {
                if self.cursor < self.text.chars().count() {
                    let from = self.byte(self.cursor);
                    let to = self.byte(self.cursor + 1);
                    self.text.replace_range(from..to, "");
                }
            }
            KeyCode::Left => self.cursor = self.cursor.saturating_sub(1),
            KeyCode::Right => self.cursor = (self.cursor + 1).min(self.text.chars().count()),
            KeyCode::Home => self.cursor = 0,
            KeyCode::End => self.cursor = self.text.chars().count(),
            _ => return false,
        }
        true
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfirmKind {
    Quit,
    DiscardEditor,
    Rollback(u64),
    Ban,
}

pub struct UploadProgress {
    pub name: String,
    pub total: u64,
    pub sent: Arc<AtomicU64>,
}

pub enum Modal {
    Help { scroll: usize },
    Palette { filter: LineInput, selected: usize },
    Share { selected: usize },
    History { selected: usize, diff_scroll: usize },
    Diff { title: String, lines: Vec<(char, String)>, scroll: usize },
    Conflict { mine: String, theirs: String, theirs_ts: u64, who: String },
    Confirm { kind: ConfirmKind, text: String },
    FilePrompt { input: LineInput, burn: bool, error: Option<String>, completions: Vec<String>, comp_idx: usize },
    Files { selected: usize },
    Download { url: String, input: LineInput, burn_note: bool },
    Moderation { person: usize, ban: usize, in_bans: bool, bans: Vec<(String, String)>, status: String },
    Actions { index: usize, selected: usize },
    Search { query: LineInput, selected: usize },
    Text { title: String, body: String },
    Upload(UploadProgress),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tab {
    Chat,
    Doc,
    People,
}

/// Rectangles of the last frame (for mouse hit-testing).
#[derive(Debug, Default, Clone)]
pub struct Rects {
    pub chat: Rect,
    pub doc: Rect,
    pub people: Rect,
    pub composer: Rect,
    pub tabs: Vec<(Rect, Tab)>,
    pub people_rows: Vec<(Rect, usize)>,
}

pub struct EditorState {
    pub ta: TextArea<'static>,
    pub base_updated_at: u64,
    pub base_version: u64,
    pub original: String,
    pub saving: bool,
    pub preview: bool,
    pub loaded: bool,
    pub remote: Option<RemoteChange>,
    pub error: Option<String>,
}

#[derive(Debug, Clone)]
pub struct RemoteChange {
    pub who: String,
    pub version: u64,
    pub content: String,
    pub updated_at: u64,
}

pub enum Mode {
    Workspace,
    Editor(Box<EditorState>),
}

#[derive(Debug, Clone, Copy)]
pub enum SaveKind {
    Edit,
    Overwrite,
    Rollback(u64),
    Export,
}

pub enum AppMsg {
    Sent { id: u64, result: Result<Sent> },
    DocForEdit(Result<Doc>),
    DocRefreshed(Result<Doc>),
    Saved { kind: SaveKind, result: Result<SaveOutcome> },
    Nick(Result<String>),
    FileDone { name: String, result: Result<()> },
    Downloaded { path: String, result: Result<()> },
    Mod { what: String, result: Result<Value> },
    Bans(Result<Value>),
    Copied { result: CopyResult, what: String, text: String },
}

/// Inputs that configure an [`App`].
pub struct AppConfig {
    pub owner_admin_key: Option<String>,
    pub llm_key: Option<String>,
    pub mouse: bool,
    /// Real runs persist language changes and apply them process-wide; tests must not touch user files.
    pub persist_settings: bool,
}

pub struct ChatCache {
    pub key: (usize, usize, bool, Lang, usize, Option<u64>),
    pub lines: Vec<ratatui::text::Line<'static>>,
    /// First line index and line count of each message (index-aligned with `state.messages`).
    pub spans: Vec<(usize, usize)>,
}

pub struct DocCache {
    pub key: (usize, u64, u64, bool, String),
    pub lines: Vec<ratatui::text::Line<'static>>,
}

pub struct App {
    pub state: RoomState,
    pub client: RoomClient,
    pub control: Option<UnboundedSender<Control>>,
    pub tx: UnboundedSender<AppMsg>,
    pub theme: Theme,
    pub lang: Lang,
    pub s: &'static Strings,
    pub focus: Pane,
    pub tab: Tab,
    pub mode: Mode,
    pub modals: Vec<Modal>,
    pub composer: TextArea<'static>,
    pub sent_history: Vec<String>,
    pub hist_pos: Option<usize>,
    pub mention_sel: usize,
    pub chat_scroll: usize,
    pub chat_sel: Option<usize>,
    pub unread: usize,
    pub first_unread_seq: Option<u64>,
    pub doc_scroll: usize,
    pub people_sel: usize,
    pub toasts: VecDeque<Toast>,
    pub reveal: bool,
    pub owner_admin_key: Option<String>,
    pub llm_key: Option<String>,
    pub pending: Vec<Pending>,
    pub send_times: VecDeque<Instant>,
    pub next_id: u64,
    pub quit: bool,
    pub dirty: bool,
    pub spinner: usize,
    pub rects: Rects,
    pub mouse: bool,
    pub chat_cache: Option<ChatCache>,
    pub doc_cache: Option<DocCache>,
    pub raw_out: Vec<String>,
    pub bell: bool,
    pub chat_width: usize,
    pub persist_settings: bool,
}

fn new_composer(s: &Strings, th: &Theme) -> TextArea<'static> {
    let mut ta = TextArea::default();
    ta.set_wrap_mode(WrapMode::WordOrGlyph);
    ta.set_cursor_line_style(Style::default());
    ta.set_placeholder_text(s.composer_placeholder);
    ta.set_placeholder_style(th.dim);
    ta
}

impl App {
    pub fn new(client: RoomClient, tx: UnboundedSender<AppMsg>, cfg: AppConfig) -> App {
        let theme = Theme::detect();
        let lang = fw_core::lang::resolve();
        let s = strings(lang);
        App {
            state: RoomState::default(),
            client,
            control: None,
            tx,
            composer: new_composer(s, &theme),
            theme,
            lang,
            s,
            focus: Pane::Input,
            tab: Tab::Chat,
            mode: Mode::Workspace,
            modals: Vec::new(),
            sent_history: Vec::new(),
            hist_pos: None,
            mention_sel: 0,
            chat_scroll: 0,
            chat_sel: None,
            unread: 0,
            first_unread_seq: None,
            doc_scroll: 0,
            people_sel: 0,
            toasts: VecDeque::new(),
            reveal: false,
            owner_admin_key: cfg.owner_admin_key,
            llm_key: cfg.llm_key,
            pending: Vec::new(),
            send_times: VecDeque::new(),
            next_id: 1,
            quit: false,
            dirty: true,
            spinner: 0,
            rects: Rects::default(),
            mouse: cfg.mouse,
            chat_cache: None,
            doc_cache: None,
            raw_out: Vec::new(),
            bell: std::env::var("FOURWORDS_BELL").as_deref() == Ok("1"),
            chat_width: 80,
            persist_settings: cfg.persist_settings,
        }
    }

    // ---- small helpers ------------------------------------------------------------------

    pub fn toast(&mut self, kind: ToastKind, text: impl Into<String>) {
        let secs = if kind == ToastKind::Err { 8 } else { 4 };
        self.toasts.push_back(Toast { kind, text: text.into(), until: Instant::now() + Duration::from_secs(secs) });
        while self.toasts.len() > 3 {
            self.toasts.pop_front();
        }
        self.dirty = true;
    }

    pub fn is_owner(&self) -> bool {
        self.owner_admin_key.is_some()
    }

    pub fn composer_text(&self) -> String {
        self.composer.lines().join("\n")
    }

    pub fn composer_len(&self) -> usize {
        self.composer_text().chars().count()
    }

    pub fn set_lang(&mut self, lang: Lang) {
        self.lang = lang;
        self.s = strings(lang);
        if self.persist_settings {
            fw_core::lang::set_override(lang);
            let _ = fw_core::config::save_lang(lang);
        }
        let text = self.composer_text();
        self.composer = new_composer(self.s, &self.theme);
        self.composer.insert_str(text);
        self.chat_cache = None;
        self.doc_cache = None;
    }

    pub fn link(&self) -> String {
        self.state.info.link.clone().unwrap_or_else(|| self.client.room().to_string())
    }

    pub fn mask(&self, text: &str) -> String {
        if self.reveal { text.to_string() } else { fw_core::sanitize::mask_secrets(text, self.lang) }
    }

    pub fn file_messages(&self) -> Vec<usize> {
        self.state.messages.iter().enumerate().filter(|(_, m)| m.file_url.is_some()).map(|(i, _)| i).collect()
    }

    /// Mention candidates for the `@token` at the composer cursor.
    pub fn mention_candidates(&self) -> (String, Vec<String>) {
        let (row, col) = {
            let c = self.composer.cursor();
            (c.0, c.1)
        };
        let line = self.composer.lines().get(row).cloned().unwrap_or_default();
        let before: String = line.chars().take(col).collect();
        let Some(at) = before.rfind('@') else { return (String::new(), vec![]) };
        let prev_ok = before[..at].chars().next_back().map(|c| c.is_whitespace()).unwrap_or(true);
        let token = &before[at + 1..];
        if !prev_ok || token.contains(char::is_whitespace) {
            return (String::new(), vec![]);
        }
        let prefix = token.to_lowercase();
        let mut names: Vec<String> =
            self.state.participants.iter().filter(|p| p.nick != self.state.my_nick).map(|p| p.nick.clone()).collect();
        names.push("all".into());
        names.retain(|n| n.to_lowercase().starts_with(&prefix));
        names.sort();
        names.dedup();
        (token.to_string(), names)
    }

    fn complete_mention(&mut self) -> bool {
        let (token, names) = self.mention_candidates();
        if names.is_empty() {
            return false;
        }
        let pick = names[self.mention_sel.min(names.len() - 1)].clone();
        for _ in 0..token.chars().count() {
            self.composer.delete_char();
        }
        self.composer.insert_str(format!("{pick} "));
        self.mention_sel = 0;
        true
    }

    // ---- engine events ---------------------------------------------------------------------

    pub fn on_engine_event(&mut self, event: Event) {
        let was_at_bottom = self.chat_scroll == 0;
        let conn_before = self.state.conn.clone();
        let applied: Applied = self.state.apply(event.clone());
        self.dirty = true;
        if let Event::Conn(conn) = &event
            && matches!(conn_before, Conn::Reconnecting { .. })
            && matches!(conn, Conn::Live(_))
        {
            self.toast(ToastKind::Ok, self.s.live_sse);
        }
        if applied.new_messages > 0 {
            self.chat_cache = None;
            let focused_here = self.focus == Pane::Input || self.focus == Pane::Chat;
            if !was_at_bottom || !focused_here {
                if self.unread == 0 {
                    self.first_unread_seq = self.state.messages.iter().rev().nth(applied.new_messages.saturating_sub(1)).map(|m| m.seq);
                }
                self.unread += applied.new_messages;
            } else {
                self.chat_scroll = 0;
            }
            // reconcile optimistic entries with the real message
            let seqs: Vec<u64> = self.state.messages.iter().map(|m| m.seq).collect();
            self.pending.retain(|p| !matches!(p.state, SendState::Sent(seq) if seqs.contains(&seq)));
            if applied.mentioned {
                let who = self.state.messages.back().map(|m| m.nick.clone()).unwrap_or_default();
                self.toast(ToastKind::Warn, fmt(self.s.mentioned, &[("who", &who)]));
                if self.bell {
                    self.raw_out.push("\x07".into());
                }
            }
        }
        let live = matches!(self.state.conn, Conn::Live(_));
        for nick in &applied.joined {
            if live && *nick != self.state.my_nick {
                self.toast(ToastKind::Info, fmt(self.s.joined, &[("nick", nick)]));
            }
        }
        for nick in &applied.left {
            if live {
                self.toast(ToastKind::Info, fmt(self.s.left, &[("nick", nick)]));
            }
        }
        if let Event::Doc { doc, additions, deletions, initial } = &event {
            self.doc_cache = None;
            if !initial {
                if let Some(who) = &applied.doc_changed_by
                    && *who != self.state.my_nick
                {
                    self.toast(
                        ToastKind::Info,
                        fmt(self.s.doc_remote, &[("who", who), ("a", &additions.to_string()), ("d", &deletions.to_string())]),
                    );
                }
                if let Mode::Editor(editor) = &mut self.mode
                    && doc.updated_at != editor.base_updated_at
                    && applied.doc_changed_by.as_deref() != Some(self.state.my_nick.as_str())
                {
                    editor.remote = Some(RemoteChange {
                        who: doc.editor.clone().unwrap_or_else(|| "?".into()),
                        version: doc.version,
                        content: doc.content.clone(),
                        updated_at: doc.updated_at,
                    });
                }
            }
        }
        if let Event::Conn(Conn::Ended(_)) = &event {
            self.chat_cache = None;
        }
        let max = self.state.participants.len().saturating_sub(1);
        self.people_sel = self.people_sel.min(max);
    }

    // ---- background task results --------------------------------------------------------------

    pub fn on_msg(&mut self, msg: AppMsg) {
        self.dirty = true;
        match msg {
            AppMsg::Sent { id, result } => {
                if let Some(p) = self.pending.iter_mut().find(|p| p.id == id) {
                    match result {
                        Ok(sent) => p.state = SendState::Sent(sent.seq),
                        Err(e) => p.state = SendState::Failed(e.to_string()),
                    }
                }
            }
            AppMsg::DocForEdit(result) => match result {
                Ok(doc) => {
                    self.state.doc = doc.clone();
                    self.state.doc_loaded = true;
                    self.doc_cache = None;
                    if let Mode::Editor(editor) = &mut self.mode {
                        let lines: Vec<String> = doc.content.split('\n').map(str::to_string).collect();
                        let mut ta = TextArea::new(lines);
                        style_editor(&mut ta, &self.theme);
                        editor.ta = ta;
                        editor.base_updated_at = doc.updated_at;
                        editor.base_version = doc.version;
                        editor.original = doc.content;
                        editor.loaded = true;
                        editor.remote = None;
                    }
                }
                Err(e) => {
                    self.mode = Mode::Workspace;
                    self.toast(ToastKind::Err, e.to_string());
                }
            },
            AppMsg::DocRefreshed(result) => {
                if let Ok(doc) = result {
                    self.state.doc = doc;
                    self.state.doc_loaded = true;
                    self.doc_cache = None;
                }
            }
            AppMsg::Saved { kind, result } => self.on_saved(kind, result),
            AppMsg::Nick(result) => match result {
                Ok(nick) => {
                    self.on_engine_event(Event::NickChanged(nick.clone()));
                    if let Some(c) = &self.control {
                        let _ = c.send(Control::NickChanged(nick.clone()));
                    }
                    self.toast(ToastKind::Ok, fmt(self.s.nick_new, &[("nick", &nick)]));
                }
                Err(e) => self.toast(ToastKind::Err, e.to_string()),
            },
            AppMsg::FileDone { name, result } => {
                self.modals.retain(|m| !matches!(m, Modal::Upload(_)));
                match result {
                    Ok(()) => self.toast(ToastKind::Ok, fmt(self.s.file_sent, &[("name", &name)])),
                    Err(e) => self.toast(ToastKind::Err, e.to_string()),
                }
            }
            AppMsg::Downloaded { path, result } => match result {
                Ok(()) => self.toast(ToastKind::Ok, fmt(self.s.saved_to, &[("path", &path)])),
                Err(e) => self.toast(ToastKind::Err, fmt(self.s.save_failed, &[("reason", &e.to_string())])),
            },
            AppMsg::Mod { what, result } => match result {
                Ok(v) => {
                    self.toast(ToastKind::Ok, fmt(self.s.mod_done, &[("what", &what)]));
                    self.apply_bans(&v);
                    self.refresh_bans();
                }
                Err(e) => self.toast(ToastKind::Err, e.to_string()),
            },
            AppMsg::Bans(result) => match result {
                Ok(v) => self.apply_bans(&v),
                Err(e) => self.toast(ToastKind::Err, e.to_string()),
            },
            AppMsg::Copied { result, what, text } => match result {
                CopyResult::Tool(_) => self.toast(ToastKind::Ok, fmt(self.s.copied, &[("what", &what)])),
                CopyResult::Osc52 => {
                    self.raw_out.push(clip::osc52(&text));
                    self.toast(ToastKind::Ok, fmt(self.s.copied, &[("what", &what)]));
                }
                CopyResult::Unavailable => {
                    self.toast(ToastKind::Warn, self.s.copy_shown);
                    self.modals.push(Modal::Text { title: what, body: text });
                }
            },
        }
    }

    fn apply_bans(&mut self, value: &Value) {
        let list: Vec<(String, String)> = value
            .get("bans")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .map(|b| {
                        let nick = b.get("nick").and_then(Value::as_str).unwrap_or("?").to_string();
                        let id = ["id", "ban_id", "banId"].iter().find_map(|k| b.get(*k).and_then(Value::as_str)).unwrap_or("").to_string();
                        (fw_core::sanitize::clean_line(&nick), fw_core::sanitize::clean_line(&id))
                    })
                    .collect()
            })
            .unwrap_or_default();
        if let Some(Modal::Moderation { bans, .. }) = self.modals.iter_mut().find(|m| matches!(m, Modal::Moderation { .. })) {
            *bans = list;
        }
    }

    fn refresh_bans(&mut self) {
        let Some(key) = self.owner_admin_key.clone() else { return };
        let client = self.client.clone();
        let tx = self.tx.clone();
        tokio::spawn(async move {
            let _ = tx.send(AppMsg::Bans(client.moderate(&key, "list", None, None).await));
        });
    }

    fn on_saved(&mut self, kind: SaveKind, result: Result<SaveOutcome>) {
        if let Mode::Editor(editor) = &mut self.mode {
            editor.saving = false;
        }
        match result {
            Ok(SaveOutcome::Saved { doc, export_url, .. }) => {
                let version = doc.version;
                let mut doc = doc;
                if doc.history.is_empty() {
                    doc.history = std::mem::take(&mut self.state.doc.history);
                }
                self.state.doc = doc.clone();
                self.doc_cache = None;
                match kind {
                    SaveKind::Edit | SaveKind::Overwrite => {
                        if let Mode::Editor(editor) = &mut self.mode {
                            editor.base_updated_at = doc.updated_at;
                            editor.base_version = doc.version;
                            editor.original = editor.ta.lines().join("\n");
                            editor.remote = None;
                            editor.error = None;
                        }
                        self.modals.retain(|m| !matches!(m, Modal::Conflict { .. }));
                        self.toast(ToastKind::Ok, fmt(self.s.doc_saved, &[("v", &version.to_string())]));
                        self.refresh_doc();
                    }
                    SaveKind::Rollback(v) => {
                        self.toast(ToastKind::Ok, fmt(self.s.rolled_back, &[("v", &v.to_string())]));
                        self.refresh_doc();
                    }
                    SaveKind::Export => {
                        if let Some(url) = export_url {
                            self.toast(ToastKind::Ok, fmt(self.s.export_done, &[("url", &url)]));
                            self.modals.push(Modal::Text { title: self.s.history_title.into(), body: url });
                        }
                        self.refresh_doc();
                    }
                }
            }
            Ok(SaveOutcome::Conflict { current_content, current_updated_at }) => {
                let who = self.state.doc.editor.clone().unwrap_or_else(|| "?".into());
                let mine = match &self.mode {
                    Mode::Editor(e) => e.ta.lines().join("\n"),
                    Mode::Workspace => String::new(),
                };
                self.modals.push(Modal::Conflict { mine, theirs: current_content, theirs_ts: current_updated_at, who });
            }
            Err(e) => {
                if let Mode::Editor(editor) = &mut self.mode {
                    editor.error = Some(e.to_string());
                }
                self.toast(ToastKind::Err, e.to_string());
            }
        }
    }

    pub fn refresh_doc(&mut self) {
        let client = self.client.clone();
        let tx = self.tx.clone();
        tokio::spawn(async move {
            let _ = tx.send(AppMsg::DocRefreshed(client.get_doc().await));
        });
    }

    pub fn on_tick(&mut self) {
        self.spinner = self.spinner.wrapping_add(1);
        let now = Instant::now();
        let before = self.toasts.len();
        self.toasts.retain(|t| t.until > now);
        let has_uploads = self.modals.iter().any(|m| matches!(m, Modal::Upload(_)));
        let sending = self.pending.iter().any(|p| p.state == SendState::Sending);
        let busy = matches!(&self.mode, Mode::Editor(e) if e.saving || !e.loaded);
        // keep the expiry countdown fresh once a second
        if self.toasts.len() != before || has_uploads || sending || busy || self.spinner.is_multiple_of(2) {
            self.dirty = true;
        }
        self.pending.retain(|p| !(matches!(p.state, SendState::Sent(_)) && now.duration_since(p.at) > Duration::from_secs(8)));
    }

    // ---- sending ---------------------------------------------------------------------------

    pub fn rate_wait(&mut self) -> Option<u64> {
        let now = Instant::now();
        while self.send_times.front().is_some_and(|t| now.duration_since(*t) > Duration::from_secs(60)) {
            self.send_times.pop_front();
        }
        if self.send_times.len() >= RATE_PER_MINUTE {
            let oldest = *self.send_times.front().expect("non-empty");
            return Some(60u64.saturating_sub(now.duration_since(oldest).as_secs()).max(1));
        }
        None
    }

    fn send_text(&mut self, text: String) {
        let text = text.trim_end().to_string();
        if text.trim().is_empty() {
            return;
        }
        let n = text.chars().count();
        if n > MAX_MESSAGE {
            self.toast(ToastKind::Err, fmt(self.s.too_long, &[("n", &n.to_string()), ("max", &MAX_MESSAGE.to_string())]));
            return;
        }
        if let Some(wait) = self.rate_wait() {
            self.toast(ToastKind::Warn, fmt(self.s.rate_limit, &[("n", &wait.to_string())]));
            return;
        }
        self.send_times.push_back(Instant::now());
        let id = self.next_id;
        self.next_id += 1;
        self.pending.push(Pending {
            id,
            text: text.clone(),
            state: SendState::Sending,
            at: Instant::now(),
            ts_ms: fw_core::config::now_ms(),
        });
        self.chat_scroll = 0;
        self.unread = 0;
        self.first_unread_seq = None;
        let client = self.client.clone();
        let tx = self.tx.clone();
        tokio::spawn(async move {
            let result = client.send(&text).await;
            let _ = tx.send(AppMsg::Sent { id, result });
        });
    }

    fn retry_failed(&mut self) {
        let Some(index) = self.pending.iter().position(|p| matches!(p.state, SendState::Failed(_))) else { return };
        let text = self.pending.remove(index).text;
        self.send_text(text);
    }

    fn submit_composer(&mut self) {
        let text = self.composer_text();
        if text.trim().is_empty() {
            return;
        }
        if let Some(rest) = text.trim().strip_prefix('/')
            && self.run_slash(rest)
        {
            self.clear_composer();
            return;
        }
        self.sent_history.push(text.clone());
        self.hist_pos = None;
        self.clear_composer();
        self.send_text(text);
    }

    fn clear_composer(&mut self) {
        self.composer = new_composer(self.s, &self.theme);
        self.mention_sel = 0;
    }

    /// Slash commands typed in the message box. Returns false for unknown ones (sent as chat).
    fn run_slash(&mut self, rest: &str) -> bool {
        let mut parts = rest.splitn(2, char::is_whitespace);
        let name = parts.next().unwrap_or("").to_lowercase();
        let arg = parts.next().unwrap_or("").trim().to_string();
        match name.as_str() {
            "help" | "h" | "?" => self.run_cmd(Cmd::Help),
            "edit" | "doc" => self.run_cmd(Cmd::EditDoc),
            "history" => self.run_cmd(Cmd::History),
            "files" => self.run_cmd(Cmd::Files),
            "file" => {
                if arg.is_empty() {
                    self.run_cmd(Cmd::SendFile);
                } else {
                    self.modals.push(Modal::FilePrompt {
                        input: LineInput::with(&arg),
                        burn: true,
                        error: None,
                        completions: vec![],
                        comp_idx: 0,
                    });
                }
            }
            "share" => self.run_cmd(Cmd::Share),
            "mod" | "moderate" => self.run_cmd(Cmd::Moderation),
            "nick" => self.run_cmd(Cmd::RollNick),
            "copy" => self.run_cmd(Cmd::CopyLink),
            "search" => self.modals.push(Modal::Search { query: LineInput::with(&arg), selected: 0 }),
            "lang" => self.run_cmd(Cmd::CycleLang),
            "theme" => self.run_cmd(Cmd::CycleTheme),
            "reveal" => self.run_cmd(Cmd::ToggleReveal),
            "quit" | "q" | "exit" => self.run_cmd(Cmd::Quit),
            _ => return false,
        }
        true
    }

    // ---- commands ---------------------------------------------------------------------------

    pub fn copy_text(&mut self, what: &str, text: String) {
        let tx = self.tx.clone();
        let what = what.to_string();
        tokio::spawn(async move {
            let result = clip::copy(&text).await;
            let _ = tx.send(AppMsg::Copied { result, what, text });
        });
    }

    pub fn run_cmd(&mut self, cmd: Cmd) {
        self.dirty = true;
        match cmd {
            Cmd::Help => self.modals.push(Modal::Help { scroll: 0 }),
            Cmd::Palette => self.modals.push(Modal::Palette { filter: LineInput::default(), selected: 0 }),
            Cmd::EditDoc => self.begin_edit(),
            Cmd::History => {
                self.refresh_doc();
                self.modals.push(Modal::History { selected: 0, diff_scroll: 0 });
            }
            Cmd::SendFile => self.modals.push(Modal::FilePrompt {
                input: LineInput::default(),
                burn: true,
                error: None,
                completions: vec![],
                comp_idx: 0,
            }),
            Cmd::Files => self.modals.push(Modal::Files { selected: 0 }),
            Cmd::Share => self.modals.push(Modal::Share { selected: 0 }),
            Cmd::Moderation => {
                self.modals.push(Modal::Moderation { person: 0, ban: 0, in_bans: false, bans: vec![], status: String::new() });
                if self.is_owner() {
                    self.refresh_bans();
                }
            }
            Cmd::RollNick => {
                let client = self.client.clone();
                let tx = self.tx.clone();
                tokio::spawn(async move {
                    let _ = tx.send(AppMsg::Nick(client.roll_nick().await));
                });
            }
            Cmd::CopyLink => {
                let link = self.link();
                self.copy_text(&link.clone(), link);
            }
            Cmd::Search => self.modals.push(Modal::Search { query: LineInput::default(), selected: 0 }),
            Cmd::ToggleReveal => {
                self.reveal = !self.reveal;
                self.chat_cache = None;
                self.doc_cache = None;
                let text = if self.reveal { self.s.revealed } else { self.s.hidden };
                self.toast(ToastKind::Info, text);
            }
            Cmd::CycleLang => {
                self.set_lang(self.lang.next());
                self.toast(ToastKind::Info, fmt(self.s.lang_changed, &[("lang", &self.lang.code().to_uppercase())]));
            }
            Cmd::CycleTheme => {
                self.theme = self.theme.next();
                self.chat_cache = None;
                self.doc_cache = None;
                let name = format!("{:?}", self.theme.name);
                self.toast(ToastKind::Info, fmt(self.s.theme_changed, &[("name", &name)]));
            }
            Cmd::JumpEnd => {
                self.chat_scroll = 0;
                self.chat_sel = None;
                self.unread = 0;
                self.first_unread_seq = None;
            }
            Cmd::FocusChat => {
                self.focus = Pane::Chat;
                self.tab = Tab::Chat;
                self.chat_sel = self.chat_sel.or(self.state.messages.len().checked_sub(1));
            }
            Cmd::FocusDoc => {
                self.focus = Pane::Doc;
                self.tab = Tab::Doc;
            }
            Cmd::FocusPeople => {
                self.focus = Pane::People;
                self.tab = Tab::People;
            }
            Cmd::Quit => {
                if let Mode::Editor(e) = &self.mode
                    && editor_dirty(e)
                {
                    self.modals.push(Modal::Confirm { kind: ConfirmKind::DiscardEditor, text: self.s.discard_body.into() });
                    return;
                }
                self.modals.push(Modal::Confirm { kind: ConfirmKind::Quit, text: self.s.quit_body.into() });
            }
        }
    }

    fn begin_edit(&mut self) {
        let mut ta = TextArea::new(self.state.doc.content.split('\n').map(str::to_string).collect());
        style_editor(&mut ta, &self.theme);
        self.mode = Mode::Editor(Box::new(EditorState {
            ta,
            base_updated_at: self.state.doc.updated_at,
            base_version: self.state.doc.version,
            original: self.state.doc.content.clone(),
            saving: false,
            preview: false,
            loaded: false,
            remote: None,
            error: None,
        }));
        // Fetch the authoritative revision: its `updated_at` is the base the server checks on save.
        let client = self.client.clone();
        let tx = self.tx.clone();
        tokio::spawn(async move {
            let _ = tx.send(AppMsg::DocForEdit(client.get_doc().await));
        });
    }

    fn save_editor(&mut self, kind: SaveKind, base: Option<u64>, content: Option<String>) {
        let Mode::Editor(editor) = &mut self.mode else { return };
        if editor.saving || !editor.loaded {
            return;
        }
        let content = content.unwrap_or_else(|| editor.ta.lines().join("\n"));
        if content.chars().count() > MAX_DOC {
            let msg = fmt(self.s.editor_over, &[("max", &MAX_DOC.to_string())]);
            self.toast(ToastKind::Err, msg);
            return;
        }
        let base = base.unwrap_or(editor.base_updated_at);
        editor.saving = true;
        let client = self.client.clone();
        let tx = self.tx.clone();
        tokio::spawn(async move {
            let result = client.save_doc(&content, base, false).await;
            let _ = tx.send(AppMsg::Saved { kind, result });
        });
    }

    // ---- terminal events ----------------------------------------------------------------------

    pub fn on_term_event(&mut self, event: CtEvent) {
        self.dirty = true;
        match event {
            CtEvent::Key(key) => {
                if key.kind == KeyEventKind::Release {
                    return;
                }
                self.on_key(key);
            }
            CtEvent::Paste(text) => self.on_paste(text),
            CtEvent::Mouse(mouse) if self.mouse => self.on_mouse(mouse),
            _ => {}
        }
    }

    fn on_paste(&mut self, text: String) {
        let text = fw_core::sanitize::doc_safe(&text);
        match self.modals.last_mut() {
            Some(Modal::Palette { filter, .. }) => filter.insert_str(&text),
            Some(Modal::FilePrompt { input, .. }) | Some(Modal::Download { input, .. }) => input.insert_str(text.trim()),
            Some(Modal::Search { query, .. }) => query.insert_str(&text),
            Some(_) => {}
            None => match &mut self.mode {
                Mode::Editor(e) => {
                    e.ta.insert_str(text);
                }
                Mode::Workspace => {
                    self.focus = Pane::Input;
                    self.composer.insert_str(text);
                }
            },
        }
    }

    fn on_key(&mut self, key: KeyEvent) {
        if !self.modals.is_empty() {
            self.modal_key(key);
            return;
        }
        let ctrl = key.modifiers.contains(KeyModifiers::CONTROL);
        if matches!(self.mode, Mode::Editor(_)) {
            self.editor_key(key);
            return;
        }
        // global shortcuts (work while typing)
        match key.code {
            KeyCode::F(1) => return self.run_cmd(Cmd::Help),
            KeyCode::F(2) => return self.run_cmd(Cmd::EditDoc),
            KeyCode::F(3) => return self.run_cmd(Cmd::History),
            KeyCode::F(4) => return self.run_cmd(Cmd::SendFile),
            KeyCode::F(5) => return self.run_cmd(Cmd::Share),
            KeyCode::F(6) => return self.run_cmd(Cmd::Moderation),
            KeyCode::Char('c') if ctrl => return self.run_cmd(Cmd::Quit),
            KeyCode::Char('p') if ctrl => return self.run_cmd(Cmd::Palette),
            KeyCode::Char('r') if ctrl => return self.run_cmd(Cmd::ToggleReveal),
            KeyCode::Char('y') if ctrl => return self.run_cmd(Cmd::CopyLink),
            KeyCode::Char('l') if ctrl => return self.run_cmd(Cmd::CycleLang),
            KeyCode::Char('t') if ctrl => return self.run_cmd(Cmd::CycleTheme),
            KeyCode::PageUp => return self.scroll_chat(self.page(), true),
            KeyCode::PageDown if self.focus != Pane::Doc => return self.scroll_chat(self.page(), false),
            KeyCode::BackTab => return self.cycle_focus(false),
            _ => {}
        }
        match self.focus {
            Pane::Input => self.input_key(key),
            Pane::Chat => self.chat_key(key),
            Pane::Doc => self.doc_key(key),
            Pane::People => self.people_key(key),
        }
    }

    fn page(&self) -> usize {
        (self.rects.chat.height as usize).saturating_sub(3).max(3)
    }

    fn cycle_focus(&mut self, forward: bool) {
        let order = [Pane::Input, Pane::Chat, Pane::Doc, Pane::People];
        let at = order.iter().position(|p| *p == self.focus).unwrap_or(0);
        let next = if forward { (at + 1) % order.len() } else { (at + order.len() - 1) % order.len() };
        match order[next] {
            Pane::Chat => self.run_cmd(Cmd::FocusChat),
            Pane::Doc => self.run_cmd(Cmd::FocusDoc),
            Pane::People => self.run_cmd(Cmd::FocusPeople),
            Pane::Input => {
                self.focus = Pane::Input;
                self.tab = Tab::Chat;
            }
        }
    }

    fn scroll_chat(&mut self, lines: usize, up: bool) {
        let total = self.chat_cache.as_ref().map(|c| c.lines.len()).unwrap_or(0);
        if up {
            self.chat_scroll = (self.chat_scroll + lines).min(total.saturating_sub(1));
        } else {
            self.chat_scroll = self.chat_scroll.saturating_sub(lines);
            if self.chat_scroll == 0 {
                self.unread = 0;
                self.first_unread_seq = None;
            }
        }
    }

    fn input_key(&mut self, key: KeyEvent) {
        let ctrl = key.modifiers.contains(KeyModifiers::CONTROL);
        let alt = key.modifiers.contains(KeyModifiers::ALT);
        let shift = key.modifiers.contains(KeyModifiers::SHIFT);
        let (token, names) = self.mention_candidates();
        let popup = !names.is_empty() || !token.is_empty() && !names.is_empty();
        match key.code {
            KeyCode::Enter if alt || shift => self.composer.insert_newline(),
            KeyCode::Char('j') if ctrl => self.composer.insert_newline(),
            KeyCode::Enter if popup => {
                self.complete_mention();
            }
            KeyCode::Tab if popup => {
                self.complete_mention();
            }
            KeyCode::Tab => self.cycle_focus(true),
            KeyCode::Enter => self.submit_composer(),
            KeyCode::Esc => {
                if self.chat_scroll > 0 {
                    self.run_cmd(Cmd::JumpEnd);
                } else {
                    self.run_cmd(Cmd::FocusChat);
                }
            }
            KeyCode::Up if popup => self.mention_sel = self.mention_sel.saturating_sub(1),
            KeyCode::Down if popup => self.mention_sel = (self.mention_sel + 1).min(names.len().saturating_sub(1)),
            KeyCode::Up if self.composer.lines().len() <= 1 => self.history_prev(),
            KeyCode::Down if self.composer.lines().len() <= 1 && self.hist_pos.is_some() => self.history_next(),
            KeyCode::Char('r')
                if !ctrl && self.composer_text().is_empty() && self.pending.iter().any(|p| matches!(p.state, SendState::Failed(_))) =>
            {
                self.retry_failed();
            }
            _ => {
                if self.composer_len() >= MAX_MESSAGE + 500 && matches!(key.code, KeyCode::Char(_)) {
                    return;
                }
                self.composer.input(key);
                self.mention_sel = 0;
                self.hist_pos = None;
            }
        }
    }

    fn history_prev(&mut self) {
        if self.sent_history.is_empty() {
            return;
        }
        let pos = match self.hist_pos {
            None => self.sent_history.len() - 1,
            Some(p) => p.saturating_sub(1),
        };
        self.hist_pos = Some(pos);
        let text = self.sent_history[pos].clone();
        self.composer = new_composer(self.s, &self.theme);
        self.composer.insert_str(text);
    }

    fn history_next(&mut self) {
        let Some(p) = self.hist_pos else { return };
        self.composer = new_composer(self.s, &self.theme);
        if p + 1 < self.sent_history.len() {
            self.hist_pos = Some(p + 1);
            let text = self.sent_history[p + 1].clone();
            self.composer.insert_str(text);
        } else {
            self.hist_pos = None;
        }
    }

    fn chat_key(&mut self, key: KeyEvent) {
        let total = self.state.messages.len();
        match key.code {
            KeyCode::Esc => {
                self.focus = Pane::Input;
                self.chat_sel = None;
            }
            KeyCode::Tab => self.cycle_focus(true),
            KeyCode::Up | KeyCode::Char('k') => self.move_selection(-1),
            KeyCode::Down | KeyCode::Char('j') => self.move_selection(1),
            KeyCode::Home | KeyCode::Char('g') => {
                self.chat_sel = (total > 0).then_some(0);
                self.scroll_to_selection();
            }
            KeyCode::End | KeyCode::Char('G') => self.run_cmd(Cmd::JumpEnd),
            KeyCode::Enter => {
                if let Some(index) = self.chat_sel {
                    self.modals.push(Modal::Actions { index, selected: 0 });
                }
            }
            KeyCode::Char('/') => self.modals.push(Modal::Search { query: LineInput::default(), selected: 0 }),
            KeyCode::Char('y') => {
                if let Some(m) = self.chat_sel.and_then(|i| self.state.messages.get(i)) {
                    let text = m.text.clone();
                    self.copy_text("message", text);
                }
            }
            KeyCode::Char('r') => self.retry_failed(),
            KeyCode::Char('f') => self.run_cmd(Cmd::Files),
            _ => {}
        }
    }

    fn move_selection(&mut self, delta: isize) {
        let total = self.state.messages.len();
        if total == 0 {
            return;
        }
        let current = self.chat_sel.unwrap_or(total - 1) as isize;
        let next = (current + delta).clamp(0, total as isize - 1) as usize;
        self.chat_sel = Some(next);
        self.scroll_to_selection();
    }

    /// Scrolls so the selected message is visible.
    pub fn scroll_to_selection(&mut self) {
        let (Some(index), Some(cache)) = (self.chat_sel, self.chat_cache.as_ref()) else { return };
        let Some(&(start, len)) = cache.spans.get(index) else { return };
        let total = cache.lines.len();
        let height = self.rects.chat.height.saturating_sub(2) as usize;
        let from_bottom_end = total.saturating_sub(start + len);
        let from_bottom_start = total.saturating_sub(start);
        if from_bottom_end < self.chat_scroll {
            self.chat_scroll = from_bottom_end;
        } else if from_bottom_start > self.chat_scroll + height {
            self.chat_scroll = from_bottom_start.saturating_sub(height);
        }
        if self.chat_scroll == 0 {
            self.unread = 0;
            self.first_unread_seq = None;
        }
    }

    fn doc_key(&mut self, key: KeyEvent) {
        let total = self.doc_cache.as_ref().map(|c| c.lines.len()).unwrap_or(0);
        let page = (self.rects.doc.height as usize).saturating_sub(3).max(3);
        match key.code {
            KeyCode::Esc => self.focus = Pane::Input,
            KeyCode::Tab => self.cycle_focus(true),
            KeyCode::Up | KeyCode::Char('k') => self.doc_scroll = self.doc_scroll.saturating_sub(1),
            KeyCode::Down | KeyCode::Char('j') => self.doc_scroll = (self.doc_scroll + 1).min(total.saturating_sub(1)),
            KeyCode::PageUp => self.doc_scroll = self.doc_scroll.saturating_sub(page),
            KeyCode::PageDown => self.doc_scroll = (self.doc_scroll + page).min(total.saturating_sub(1)),
            KeyCode::Home | KeyCode::Char('g') => self.doc_scroll = 0,
            KeyCode::End | KeyCode::Char('G') => self.doc_scroll = total.saturating_sub(1),
            KeyCode::Char('e') | KeyCode::Enter => self.run_cmd(Cmd::EditDoc),
            KeyCode::Char('h') => self.run_cmd(Cmd::History),
            KeyCode::Char('y') => {
                let text = self.state.doc.content.clone();
                self.copy_text("document", text);
            }
            _ => {}
        }
    }

    fn people_key(&mut self, key: KeyEvent) {
        let total = self.state.participants.len();
        match key.code {
            KeyCode::Esc => self.focus = Pane::Input,
            KeyCode::Tab => self.cycle_focus(true),
            KeyCode::Up | KeyCode::Char('k') => self.people_sel = self.people_sel.saturating_sub(1),
            KeyCode::Down | KeyCode::Char('j') => self.people_sel = (self.people_sel + 1).min(total.saturating_sub(1)),
            KeyCode::Enter => self.mention_selected_person(),
            KeyCode::Char('m') => self.run_cmd(Cmd::Moderation),
            _ => {}
        }
    }

    fn mention_selected_person(&mut self) {
        let list = self.state.sorted_participants();
        if let Some(p) = list.get(self.people_sel) {
            let nick = p.nick.clone();
            if nick != self.state.my_nick {
                self.composer.insert_str(format!("@{nick} "));
            }
        }
        self.focus = Pane::Input;
        self.tab = Tab::Chat;
    }

    // ---- mouse -----------------------------------------------------------------------------

    fn on_mouse(&mut self, mouse: MouseEvent) {
        if !self.modals.is_empty() || matches!(self.mode, Mode::Editor(_)) {
            if let MouseEventKind::ScrollUp | MouseEventKind::ScrollDown = mouse.kind {
                let up = matches!(mouse.kind, MouseEventKind::ScrollUp);
                match self.modals.last_mut() {
                    Some(Modal::Help { scroll }) => *scroll = if up { scroll.saturating_sub(3) } else { *scroll + 3 },
                    Some(Modal::Diff { scroll, .. }) => *scroll = if up { scroll.saturating_sub(3) } else { *scroll + 3 },
                    _ => {
                        if let Mode::Editor(e) = &mut self.mode {
                            use ratatui_textarea::Scrolling;
                            e.ta.scroll(Scrolling::Delta { rows: if up { -3 } else { 3 }, cols: 0 });
                        }
                    }
                }
            }
            return;
        }
        let pos = ratatui::layout::Position { x: mouse.column, y: mouse.row };
        match mouse.kind {
            MouseEventKind::ScrollUp | MouseEventKind::ScrollDown => {
                let up = matches!(mouse.kind, MouseEventKind::ScrollUp);
                if self.rects.doc.contains(pos) {
                    self.doc_scroll = if up { self.doc_scroll.saturating_sub(3) } else { self.doc_scroll + 3 };
                } else if self.rects.people.contains(pos) {
                    self.people_sel = if up { self.people_sel.saturating_sub(1) } else { self.people_sel + 1 };
                } else {
                    self.scroll_chat(3, up);
                }
            }
            MouseEventKind::Down(MouseButton::Left) => {
                for (rect, tab) in self.rects.tabs.clone() {
                    if rect.contains(pos) {
                        match tab {
                            Tab::Chat => {
                                self.focus = Pane::Input;
                                self.tab = Tab::Chat;
                            }
                            Tab::Doc => self.run_cmd(Cmd::FocusDoc),
                            Tab::People => self.run_cmd(Cmd::FocusPeople),
                        }
                        return;
                    }
                }
                for (rect, index) in self.rects.people_rows.clone() {
                    if rect.contains(pos) {
                        self.people_sel = index;
                        self.mention_selected_person();
                        return;
                    }
                }
                if self.rects.composer.contains(pos) {
                    self.focus = Pane::Input;
                } else if self.rects.doc.contains(pos) {
                    self.focus = Pane::Doc;
                } else if self.rects.people.contains(pos) {
                    self.focus = Pane::People;
                } else if self.rects.chat.contains(pos) {
                    self.focus = Pane::Chat;
                    // select the clicked message
                    let inner_top = self.rects.chat.y + 1;
                    let height = self.rects.chat.height.saturating_sub(2) as usize;
                    if let Some(cache) = &self.chat_cache {
                        let total = cache.lines.len();
                        let end = total.saturating_sub(self.chat_scroll);
                        let first = end.saturating_sub(height);
                        let row = (mouse.row.saturating_sub(inner_top)) as usize;
                        let shown = end - first;
                        let pad = height.saturating_sub(shown);
                        if row >= pad {
                            let line = first + (row - pad);
                            if let Some(index) = cache.spans.iter().position(|&(s, l)| line >= s && line < s + l) {
                                self.chat_sel = Some(index);
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }

    // ---- editor ----------------------------------------------------------------------------

    fn editor_key(&mut self, key: KeyEvent) {
        let ctrl = key.modifiers.contains(KeyModifiers::CONTROL);
        let Mode::Editor(editor) = &mut self.mode else { return };
        if !editor.loaded {
            if key.code == KeyCode::Esc {
                self.mode = Mode::Workspace;
            }
            return;
        }
        match key.code {
            KeyCode::Char('s') if ctrl => self.save_editor(SaveKind::Edit, None, None),
            KeyCode::Char('t') if ctrl => editor.preview = !editor.preview,
            KeyCode::Char('z') if ctrl => {
                editor.ta.undo();
            }
            KeyCode::Char('y') if ctrl => {
                editor.ta.redo();
            }
            KeyCode::Char('g') if ctrl => {
                if let Some(r) = editor.remote.clone() {
                    let mine = editor.ta.lines().join("\n");
                    let lines = crate::diff::unified(&mine, &r.content);
                    self.modals.push(Modal::Diff { title: format!("{} → {}", self.s.editor_title, r.who), lines, scroll: 0 });
                }
            }
            KeyCode::Char('l') if ctrl => {
                if let Some(r) = editor.remote.take() {
                    let mut ta = TextArea::new(r.content.split('\n').map(str::to_string).collect());
                    style_editor(&mut ta, &self.theme);
                    editor.ta = ta;
                    editor.base_updated_at = r.updated_at;
                    editor.base_version = r.version;
                    editor.original = r.content;
                }
            }
            KeyCode::F(1) => self.run_cmd(Cmd::Help),
            KeyCode::Esc => {
                if editor_dirty(editor) {
                    self.modals.push(Modal::Confirm { kind: ConfirmKind::DiscardEditor, text: self.s.discard_body.into() });
                } else {
                    self.mode = Mode::Workspace;
                }
            }
            KeyCode::Char('c') if ctrl => {
                if editor_dirty(editor) {
                    self.modals.push(Modal::Confirm { kind: ConfirmKind::DiscardEditor, text: self.s.discard_body.into() });
                } else {
                    self.mode = Mode::Workspace;
                }
            }
            _ => {
                editor.ta.input(key);
            }
        }
    }

    // ---- modals ----------------------------------------------------------------------------

    fn close_modal(&mut self) {
        self.modals.pop();
    }

    fn filtered_cmds(&self, filter: &str) -> Vec<Cmd> {
        let needle = filter.to_lowercase();
        ALL_CMDS
            .iter()
            .copied()
            .enumerate()
            .filter(|(i, _)| needle.is_empty() || self.s.cmds[*i].to_lowercase().contains(&needle))
            .map(|(_, c)| c)
            .collect()
    }

    pub fn search_results(&self, query: &str) -> Vec<usize> {
        if query.trim().is_empty() {
            return Vec::new();
        }
        let needle = query.to_lowercase();
        self.state
            .messages
            .iter()
            .enumerate()
            .filter(|(_, m)| m.text.to_lowercase().contains(&needle) || m.nick.to_lowercase().contains(&needle))
            .map(|(i, _)| i)
            .rev()
            .collect()
    }

    fn modal_key(&mut self, key: KeyEvent) {
        let ctrl = key.modifiers.contains(KeyModifiers::CONTROL);
        let esc = key.code == KeyCode::Esc;
        let files = self.file_messages();
        let Some(modal) = self.modals.last_mut() else { return };
        match modal {
            Modal::Help { scroll } => match key.code {
                KeyCode::Up | KeyCode::Char('k') => *scroll = scroll.saturating_sub(1),
                KeyCode::Down | KeyCode::Char('j') => *scroll += 1,
                KeyCode::PageUp => *scroll = scroll.saturating_sub(8),
                KeyCode::PageDown => *scroll += 8,
                KeyCode::Esc | KeyCode::Enter | KeyCode::Char('q') | KeyCode::F(1) => self.close_modal(),
                _ => {}
            },
            Modal::Palette { filter, selected } => match key.code {
                KeyCode::Esc => self.close_modal(),
                KeyCode::Up => *selected = selected.saturating_sub(1),
                KeyCode::Down => *selected += 1,
                KeyCode::Enter => {
                    let f = filter.text.clone();
                    let sel = *selected;
                    let list = self.filtered_cmds(&f);
                    self.close_modal();
                    if let Some(cmd) = list.get(sel.min(list.len().saturating_sub(1))) {
                        self.run_cmd(*cmd);
                    }
                }
                _ => {
                    if filter.key(&key) {
                        *selected = 0;
                    }
                }
            },
            Modal::Share { selected } => match key.code {
                KeyCode::Esc | KeyCode::Char('q') => self.close_modal(),
                KeyCode::Up => *selected = selected.saturating_sub(1),
                KeyCode::Down => *selected = (*selected + 1).min(2),
                KeyCode::Char('r') if ctrl => self.run_cmd(Cmd::ToggleReveal),
                KeyCode::Char('y') | KeyCode::Enter => {
                    let sel = *selected;
                    let (what, text) = match sel {
                        0 => ("link", Some(self.link())),
                        1 => ("llm_key", self.llm_key.clone()),
                        _ => ("admin_key", self.owner_admin_key.clone()),
                    };
                    if let Some(text) = text {
                        self.copy_text(what, text);
                    }
                }
                _ => {}
            },
            Modal::History { selected, diff_scroll } => {
                let count = self.state.doc.history.len();
                match key.code {
                    KeyCode::Esc | KeyCode::Char('q') => self.close_modal(),
                    KeyCode::Up | KeyCode::Char('k') => {
                        *selected = selected.saturating_sub(1);
                        *diff_scroll = 0;
                    }
                    KeyCode::Down | KeyCode::Char('j') => {
                        *selected = (*selected + 1).min(count.saturating_sub(1));
                        *diff_scroll = 0;
                    }
                    KeyCode::PageDown => *diff_scroll += 5,
                    KeyCode::PageUp => *diff_scroll = diff_scroll.saturating_sub(5),
                    KeyCode::Char('r') => {
                        let sel = *selected;
                        if let Some(rev) = self.state.doc.history.iter().rev().nth(sel) {
                            let v = rev.version;
                            self.modals.push(Modal::Confirm {
                                kind: ConfirmKind::Rollback(v),
                                text: fmt(self.s.rollback_confirm, &[("v", &v.to_string())]),
                            });
                        }
                    }
                    KeyCode::Char('e') => {
                        let client = self.client.clone();
                        let tx = self.tx.clone();
                        let content = self.state.doc.content.clone();
                        let base = self.state.doc.updated_at;
                        tokio::spawn(async move {
                            let result = client.save_doc(&content, base, true).await;
                            let _ = tx.send(AppMsg::Saved { kind: SaveKind::Export, result });
                        });
                    }
                    KeyCode::Char('s') => {
                        let sel = *selected;
                        if let Some(rev) = self.state.doc.history.iter().rev().nth(sel) {
                            let name = format!("4w-doc-{}-rev{}.md", crate::util::room_slug(self.client.room()), rev.version);
                            let body = rev.content.clone();
                            let result = std::fs::write(&name, body).map_err(fw_core::Error::from);
                            match result {
                                Ok(()) => self.toast(ToastKind::Ok, fmt(self.s.saved_to, &[("path", &name)])),
                                Err(e) => self.toast(ToastKind::Err, fmt(self.s.save_failed, &[("reason", &e.to_string())])),
                            }
                        }
                    }
                    KeyCode::Char('y') => {
                        let sel = *selected;
                        if let Some(rev) = self.state.doc.history.iter().rev().nth(sel) {
                            let text = rev.content.clone();
                            self.copy_text("revision", text);
                        }
                    }
                    _ => {}
                }
            }
            Modal::Diff { scroll, lines, .. } => match key.code {
                KeyCode::Esc | KeyCode::Char('q') | KeyCode::Enter => self.close_modal(),
                KeyCode::Up | KeyCode::Char('k') => *scroll = scroll.saturating_sub(1),
                KeyCode::Down | KeyCode::Char('j') => *scroll = (*scroll + 1).min(lines.len().saturating_sub(1)),
                KeyCode::PageUp => *scroll = scroll.saturating_sub(10),
                KeyCode::PageDown => *scroll = (*scroll + 10).min(lines.len().saturating_sub(1)),
                _ => {}
            },
            Modal::Conflict { mine, theirs, theirs_ts, .. } => {
                let (mine, theirs, theirs_ts) = (mine.clone(), theirs.clone(), *theirs_ts);
                match key.code {
                    KeyCode::Esc => self.close_modal(),
                    KeyCode::Char('t') | KeyCode::Char('T') => {
                        self.close_modal();
                        if let Mode::Editor(editor) = &mut self.mode {
                            let mut ta = TextArea::new(theirs.split('\n').map(str::to_string).collect());
                            style_editor(&mut ta, &self.theme);
                            editor.ta = ta;
                            editor.base_updated_at = theirs_ts;
                            editor.original = theirs;
                            editor.remote = None;
                        }
                    }
                    KeyCode::Char('o') | KeyCode::Char('O') => {
                        self.close_modal();
                        self.save_editor(SaveKind::Overwrite, Some(theirs_ts), Some(mine));
                    }
                    KeyCode::Char('l') | KeyCode::Char('L') => {
                        let name =
                            format!("4w-doc-{}-mine-{}.md", crate::util::room_slug(self.client.room()), fw_core::config::now_ms() / 1000);
                        match std::fs::write(&name, mine) {
                            Ok(()) => self.toast(ToastKind::Ok, fmt(self.s.saved_to, &[("path", &name)])),
                            Err(e) => self.toast(ToastKind::Err, fmt(self.s.save_failed, &[("reason", &e.to_string())])),
                        }
                    }
                    KeyCode::Char('d') | KeyCode::Char('D') => {
                        let lines = crate::diff::unified(&theirs, &mine);
                        self.modals.push(Modal::Diff { title: self.s.conflict_title.into(), lines, scroll: 0 });
                    }
                    _ => {}
                }
            }
            Modal::Confirm { kind, .. } => {
                let kind = *kind;
                match key.code {
                    KeyCode::Enter | KeyCode::Char('y') | KeyCode::Char('s') | KeyCode::Char('Y') | KeyCode::Char('S') => {
                        self.close_modal();
                        self.confirm_yes(kind);
                    }
                    KeyCode::Esc | KeyCode::Char('n') | KeyCode::Char('N') => self.close_modal(),
                    _ => {}
                }
            }
            Modal::FilePrompt { input, burn, error, completions, comp_idx } => match key.code {
                KeyCode::Esc => self.close_modal(),
                KeyCode::Char('b') if ctrl => *burn = !*burn,
                KeyCode::Tab => {
                    if completions.is_empty() {
                        *completions = crate::util::complete_path(&input.text);
                        *comp_idx = 0;
                    } else {
                        *comp_idx = (*comp_idx + 1) % completions.len();
                    }
                    if let Some(c) = completions.get(*comp_idx) {
                        *input = LineInput::with(c);
                    }
                }
                KeyCode::Enter => {
                    let path = crate::util::expand_home(input.text.trim());
                    let burn_flag = *burn;
                    match std::fs::metadata(&path) {
                        Ok(meta) if meta.is_file() => {
                            self.close_modal();
                            self.start_upload(path, meta.len(), burn_flag);
                        }
                        _ => *error = Some(self.s.file_missing.to_string()),
                    }
                }
                _ => {
                    if input.key(&key) {
                        completions.clear();
                        *error = None;
                    }
                }
            },
            Modal::Files { selected } => match key.code {
                KeyCode::Esc | KeyCode::Char('q') => self.close_modal(),
                KeyCode::Up | KeyCode::Char('k') => *selected = selected.saturating_sub(1),
                KeyCode::Down | KeyCode::Char('j') => *selected = (*selected + 1).min(files.len().saturating_sub(1)),
                KeyCode::Char('y') => {
                    let sel = *selected;
                    if let Some(url) = files.get(sel).and_then(|i| self.state.messages.get(*i)).and_then(|m| m.file_url.clone()) {
                        self.copy_text("file link", url);
                    }
                }
                KeyCode::Enter => {
                    let sel = *selected;
                    if let Some(m) = files.get(sel).and_then(|i| self.state.messages.get(*i)) {
                        let url = m.file_url.clone().unwrap_or_default();
                        let name = m.filename.clone().unwrap_or_else(|| crate::util::file_name_from_url(&url));
                        let dir = crate::util::downloads_dir();
                        let target = format!("{}/{}", dir.trim_end_matches('/'), crate::util::safe_name(&name));
                        self.modals.push(Modal::Download { url, input: LineInput::with(&target), burn_note: true });
                    }
                }
                _ => {}
            },
            Modal::Download { url, input, .. } => match key.code {
                KeyCode::Esc => self.close_modal(),
                KeyCode::Enter => {
                    let url = url.clone();
                    let path = crate::util::expand_home(input.text.trim());
                    self.close_modal();
                    self.start_download(url, path);
                }
                _ => {
                    input.key(&key);
                }
            },
            Modal::Moderation { person, ban, in_bans, bans, .. } => match key.code {
                KeyCode::Esc | KeyCode::Char('q') => self.close_modal(),
                KeyCode::Tab => *in_bans = !*in_bans,
                KeyCode::Up | KeyCode::Char('k') => {
                    if *in_bans {
                        *ban = ban.saturating_sub(1)
                    } else {
                        *person = person.saturating_sub(1)
                    }
                }
                KeyCode::Down | KeyCode::Char('j') => {
                    if *in_bans {
                        *ban = (*ban + 1).min(bans.len().saturating_sub(1));
                    } else {
                        *person += 1;
                    }
                }
                KeyCode::Char('r') => self.refresh_bans(),
                KeyCode::Char('v') => self.moderate("verify", None, None),
                KeyCode::Char('b') => {
                    let target = self.state.sorted_participants().get(*person_index(&self.modals)).map(|p| p.nick.clone());
                    if let Some(nick) = target
                        && nick != self.state.my_nick
                    {
                        self.moderate("ban", Some(nick), None);
                    }
                }
                KeyCode::Char('u') => {
                    let target = bans_selection(&self.modals);
                    if let Some((nick, id)) = target {
                        self.moderate("unban", Some(nick), (!id.is_empty()).then_some(id));
                    }
                }
                _ => {}
            },
            Modal::Actions { index, selected } => {
                let index = *index;
                let has_file = self.state.messages.get(index).is_some_and(|m| m.file_url.is_some());
                let count = if has_file { 3 } else { 2 };
                match key.code {
                    KeyCode::Esc | KeyCode::Char('q') => self.close_modal(),
                    KeyCode::Up | KeyCode::Char('k') => *selected = selected.saturating_sub(1),
                    KeyCode::Down | KeyCode::Char('j') => *selected = (*selected + 1).min(count - 1),
                    KeyCode::Enter => {
                        let sel = *selected;
                        self.close_modal();
                        if let Some(m) = self.state.messages.get(index).cloned() {
                            match sel {
                                0 => self.copy_text("message", m.text),
                                1 => {
                                    self.composer.insert_str(format!("@{} ", m.nick));
                                    self.focus = Pane::Input;
                                }
                                _ => {
                                    if let Some(url) = m.file_url {
                                        self.copy_text("file link", url);
                                    }
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
            Modal::Search { query, selected } => match key.code {
                KeyCode::Esc => self.close_modal(),
                KeyCode::Up => *selected = selected.saturating_sub(1),
                KeyCode::Down => *selected += 1,
                KeyCode::Enter => {
                    let q = query.text.clone();
                    let sel = *selected;
                    let results = self.search_results(&q);
                    self.close_modal();
                    if let Some(index) = results.get(sel.min(results.len().saturating_sub(1))).copied() {
                        self.chat_sel = Some(index);
                        self.focus = Pane::Chat;
                        self.scroll_to_selection();
                    }
                }
                _ => {
                    if query.key(&key) {
                        *selected = 0;
                    }
                }
            },
            Modal::Text { .. } => {
                if esc || matches!(key.code, KeyCode::Enter | KeyCode::Char('q')) {
                    self.close_modal();
                }
            }
            Modal::Upload(_) => {
                if esc {
                    self.close_modal();
                }
            }
        }
    }

    fn confirm_yes(&mut self, kind: ConfirmKind) {
        match kind {
            ConfirmKind::Quit => self.quit = true,
            ConfirmKind::DiscardEditor => self.mode = Mode::Workspace,
            ConfirmKind::Rollback(v) => {
                let client = self.client.clone();
                let tx = self.tx.clone();
                tokio::spawn(async move {
                    let result = client.rollback(v).await;
                    let _ = tx.send(AppMsg::Saved { kind: SaveKind::Rollback(v), result });
                });
            }
            ConfirmKind::Ban => {}
        }
    }

    fn moderate(&mut self, action: &'static str, nick: Option<String>, ban_id: Option<String>) {
        let Some(key) = self.owner_admin_key.clone() else {
            self.toast(ToastKind::Warn, self.s.mod_need_key);
            return;
        };
        let client = self.client.clone();
        let tx = self.tx.clone();
        tokio::spawn(async move {
            let what = format!("{action} {}", nick.clone().unwrap_or_default()).trim().to_string();
            let result = client.moderate(&key, action, nick.as_deref(), ban_id.as_deref()).await;
            let _ = tx.send(AppMsg::Mod { what, result });
        });
    }

    fn start_upload(&mut self, path: String, size: u64, burn: bool) {
        let name = crate::util::file_name_from_url(&path);
        let sent = Arc::new(AtomicU64::new(0));
        self.modals.push(Modal::Upload(UploadProgress { name: name.clone(), total: size, sent: sent.clone() }));
        let client = self.client.clone();
        let tx = self.tx.clone();
        tokio::spawn(async move {
            let result = crate::util::upload(&client, &path, &name, size, burn, sent).await;
            let _ = tx.send(AppMsg::FileDone { name, result });
        });
    }

    fn start_download(&mut self, url: String, path: String) {
        let client = self.client.clone();
        let tx = self.tx.clone();
        tokio::spawn(async move {
            let result = crate::util::download(client.mcp().endpoint(), &url, &path).await;
            let _ = tx.send(AppMsg::Downloaded { path, result });
        });
    }

    /// Commands matching the palette filter (used by the renderer too).
    pub fn palette_list(&self, filter: &str) -> Vec<Cmd> {
        self.filtered_cmds(filter)
    }

    pub fn cmd_label(&self, cmd: Cmd) -> &'static str {
        let index = ALL_CMDS.iter().position(|c| *c == cmd).unwrap_or(0);
        self.s.cmds[index]
    }

    pub fn my_message(&self, m: &Message) -> bool {
        self.state.is_mine(m)
    }

    pub fn people(&self) -> Vec<&Participant> {
        self.state.sorted_participants()
    }

    pub fn upload_fraction(&self) -> Option<f64> {
        self.modals.iter().find_map(|m| match m {
            Modal::Upload(u) if u.total > 0 => Some(u.sent.load(Ordering::Relaxed) as f64 / u.total as f64),
            _ => None,
        })
    }
}

fn person_index(modals: &[Modal]) -> &usize {
    match modals.last() {
        Some(Modal::Moderation { person, .. }) => person,
        _ => &0,
    }
}

fn bans_selection(modals: &[Modal]) -> Option<(String, String)> {
    match modals.last() {
        Some(Modal::Moderation { ban, bans, .. }) => bans.get(*ban).cloned(),
        _ => None,
    }
}

pub fn editor_dirty(editor: &EditorState) -> bool {
    editor.ta.lines().join("\n") != editor.original
}

pub fn style_editor(ta: &mut TextArea<'static>, th: &Theme) {
    ta.set_wrap_mode(WrapMode::WordOrGlyph);
    ta.set_cursor_line_style(Style::default());
    ta.set_line_number_style(th.dim);
    ta.set_tab_length(2);
}
