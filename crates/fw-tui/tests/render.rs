//! Rendering smoke/behavior tests on a `TestBackend`: no panics at any size, key content present.

use fw_core::Lang;
use fw_core::mcp::Mcp;
use fw_room::{Auth, Conn, Doc, Event, Message, Participant, Role, RoomClient, RoomInfo, Transport};
use fw_tui::app::{App, AppConfig, Cmd, Modal};
use fw_tui::theme::{Theme, ThemeName};
use fw_tui::ui;
use ratatui::Terminal;
use ratatui::backend::TestBackend;

fn app() -> App {
    let mcp = Mcp::with_endpoint("http://127.0.0.1:1/mcp".parse().unwrap(), None).unwrap();
    let client = RoomClient::new(mcp, "lua-gato-sol-rio-123456789", Auth::default());
    let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
    let mut app =
        App::new(client, tx, AppConfig { owner_admin_key: Some("fwadm_00ff".into()), llm_key: None, mouse: true, persist_settings: false });
    let human = |n: &str| Participant {
        nick: n.into(),
        role: Role::Human,
        via: vec!["sse".into()],
        model: None,
        status: None,
        status_detail: None,
        status_since: None,
    };
    let agent = Participant {
        nick: "bia".into(),
        role: Role::Llm,
        via: vec![],
        model: Some("claude".into()),
        status: Some("working".into()),
        status_detail: Some("sending_reply".into()),
        status_since: None,
    };
    app.on_engine_event(Event::Ready(RoomInfo {
        room: "r".into(),
        nick: "eu-1".into(),
        link: Some("https://4words.example/lua-gato-sol-rio-123456789".into()),
        ..Default::default()
    }));
    app.on_engine_event(Event::Presence(vec![human("eu-1"), human("ana"), agent]));
    let msg = |seq: u64, nick: &str, text: &str, ts: u64| Message {
        seq,
        nick: nick.into(),
        ts,
        role: Role::Human,
        text: text.into(),
        file_url: None,
        filename: None,
    };
    let now = fw_core::config::now_ms();
    app.on_engine_event(Event::Messages {
        messages: vec![
            msg(
                1,
                "ana",
                "oi pessoal, tudo bem? esta mensagem é longa o bastante para quebrar em várias linhas dentro do painel de conversa",
                now - 90_000_000,
            ),
            msg(2, "ana", "@eu-1 ficou ótimo", now - 1000),
            Message {
                seq: 3,
                nick: "bia".into(),
                ts: now,
                role: Role::Llm,
                text: "tabela:\tcom tab e emoji 🌊 日本語".into(),
                file_url: Some("https://4words.example/arq-aaa-bbb-ccc-123456789".into()),
                filename: Some("relatorio.pdf".into()),
            },
        ],
        mentioned_me: false,
    });
    let doc = Doc {
        content: "# Plano\n\n- [x] a\n- [ ] b\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\n```\ncode\n```\n".into(),
        version: 2,
        updated_at: 7,
        editor: Some("ana".into()),
        history: vec![],
    };
    app.on_engine_event(Event::Doc { doc, initial: true, additions: 0, deletions: 0 });
    app.on_engine_event(Event::Conn(Conn::Live(Transport::Sse)));
    app
}

fn render(app: &mut App, w: u16, h: u16) -> String {
    let mut terminal = Terminal::new(TestBackend::new(w, h)).unwrap();
    terminal.draw(|f| ui::draw(f, app)).unwrap();
    let buffer = terminal.backend().buffer().clone();
    (0..buffer.area.height)
        .map(|y| (0..buffer.area.width).map(|x| buffer[(x, y)].symbol().to_string()).collect::<String>())
        .collect::<Vec<_>>()
        .join("\n")
}

#[tokio::test]
async fn never_panics_at_any_size_language_theme_or_modal() {
    let cmds = [Cmd::Help, Cmd::Palette, Cmd::Share, Cmd::History, Cmd::SendFile, Cmd::Files, Cmd::Moderation, Cmd::Search];
    for lang in Lang::ALL {
        for theme in [ThemeName::Dark, ThemeName::Light, ThemeName::HighContrast, ThemeName::Mono] {
            for unicode in [true, false] {
                for (w, h) in [
                    (10, 4),
                    (26, 8),
                    (30, 10),
                    (49, 14),
                    (60, 20),
                    (79, 24),
                    (80, 24),
                    (100, 30),
                    (119, 30),
                    (120, 40),
                    (160, 50),
                    (250, 60),
                ] {
                    let mut app = app();
                    app.set_lang(lang);
                    app.theme = Theme::new(theme, unicode);
                    render(&mut app, w, h);
                    for cmd in cmds {
                        app.run_cmd(cmd);
                        render(&mut app, w, h);
                        app.modals.clear();
                    }
                }
            }
        }
    }
}

#[test]
fn wide_layout_shows_three_panes_with_agent_status_and_masks_secrets() {
    let mut app = app();
    app.on_engine_event(Event::Messages {
        messages: vec![Message {
            seq: 4,
            nick: "bia".into(),
            ts: fw_core::config::now_ms(),
            role: Role::Llm,
            text: "chave fwllm_abc123def".into(),
            file_url: None,
            filename: None,
        }],
        mentioned_me: false,
    });
    let screen = render(&mut app, 150, 36);
    assert!(screen.contains("People (3)") && screen.contains("Chat") && screen.contains("Document · rev 2 · ana"), "{screen}");
    assert!(screen.contains("◐ bia [AI] working"), "{screen}");
    assert!(screen.contains("[x] a") && screen.contains("│ 1 │") || screen.contains("1 │ 2"), "table rendered: {screen}");
    assert!(screen.contains("[hidden]") && !screen.contains("fwllm_abc123def"), "{screen}");
    assert!(screen.contains("[file] relatorio.pdf"), "{screen}");
    assert!(screen.contains("▌"), "mention marker: {screen}");
    app.reveal = true;
    app.chat_cache = None;
    assert!(render(&mut app, 150, 36).contains("fwllm_abc123def"));
}

#[test]
fn medium_layout_uses_a_people_strip_and_narrow_uses_tabs() {
    let mut app = app();
    let medium = render(&mut app, 100, 28);
    assert!(medium.contains("● eu-1 (you)") && medium.contains("Document"), "{medium}");
    let tabs = render(&mut app, 60, 20);
    assert!(tabs.contains(" Chat ") && tabs.contains(" People "), "{tabs}");
}

#[test]
fn terminal_control_characters_never_reach_the_buffer() {
    let mut app = app();
    app.on_engine_event(Event::Messages {
        messages: vec![Message {
            seq: 9,
            nick: "x\u{1b}[2J".into(),
            ts: 0,
            role: Role::Human,
            text: "a\u{1b}]0;pwn\u{7}b\u{202e}c".into(),
            file_url: None,
            filename: None,
        }],
        mentioned_me: false,
    });
    // ingest sanitization happens in fw-room's model; the reducer receives already-clean data in
    // production. Here we assert the renderer itself never emits raw ESC/BEL even if given them.
    let screen = render(&mut app, 120, 30);
    assert!(!screen.contains('\u{1b}') && !screen.contains('\u{7}'), "no raw control characters in cells");
}

#[tokio::test]
async fn modals_stack_and_close() {
    let mut app = app();
    app.run_cmd(Cmd::Help);
    app.run_cmd(Cmd::Palette);
    assert_eq!(app.modals.len(), 2);
    assert!(matches!(app.modals.last(), Some(Modal::Palette { .. })));
    let screen = render(&mut app, 100, 30);
    assert!(screen.contains("Commands"), "{screen}");
}
