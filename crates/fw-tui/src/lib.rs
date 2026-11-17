//! Terminal UI for FourWords rooms (Ratatui).

pub mod app;
pub mod clip;
pub mod diff;
pub mod hub;
pub mod i18n;
pub mod markdown;
pub mod term;
pub mod text;
pub mod theme;
pub mod ui;
pub mod util;

use app::{App, AppConfig, AppMsg};
use fw_core::{Result, vault};
use fw_room::{Event, RoomClient, SyncOptions};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tokio::sync::mpsc::unbounded_channel;

pub struct RoomLaunch {
    pub client: RoomClient,
    pub sync: SyncOptions,
    pub mouse: bool,
    pub owner_admin_key: Option<String>,
    pub vault_link: Option<String>,
}

/// Records that the user opened this room (no secrets) so the hub can list it for 24 h.
fn remember_room(link: &str) {
    if std::env::var("FOURWORDS_NO_HISTORY").as_deref() == Ok("1") {
        return;
    }
    let _ = vault::add(vault::HistoryEntry {
        created_at: fw_core::config::now_ms(),
        command: "room open".into(),
        url: Some(link.to_string()),
        fourwords_url: Some(link.to_string()),
        ..Default::default()
    });
}

async fn wait_for_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};
        let (Ok(mut term), Ok(mut hup)) = (signal(SignalKind::terminate()), signal(SignalKind::hangup())) else {
            return std::future::pending().await;
        };
        tokio::select! {
            _ = term.recv() => {}
            _ = hup.recv() => {}
        }
    }
    #[cfg(not(unix))]
    std::future::pending::<()>().await
}

/// Opens the full-screen room workspace and runs until the user quits.
pub async fn run_room(launch: RoomLaunch) -> Result<()> {
    let room = launch.client.room().to_string();
    let llm_key = launch.client.auth().llm_key.clone().or_else(|| vault::llm_key_for(&room));
    let owner_key = launch.owner_admin_key.or_else(|| vault::admin_key_for(&room));
    let mut term = term::Term::enter(launch.mouse)?;
    let (msg_tx, mut msg_rx) = unbounded_channel::<AppMsg>();
    let mut app = App::new(
        launch.client.clone(),
        msg_tx,
        AppConfig { owner_admin_key: owner_key, llm_key, mouse: launch.mouse, persist_settings: true },
    );
    let mut session = fw_room::start(launch.client, launch.sync);
    app.control = Some(session.control());
    let (dummy_tx, dummy_rx) = unbounded_channel();
    drop(dummy_tx);
    let mut events = std::mem::replace(&mut session.events, dummy_rx);
    let (key_tx, mut key_rx) = unbounded_channel();
    let stop = Arc::new(AtomicBool::new(false));
    term::spawn_input(key_tx, stop.clone());
    let mut tick = tokio::time::interval(Duration::from_millis(500));
    let mut remembered = false;
    let signal = wait_for_signal();
    tokio::pin!(signal);
    loop {
        if app.dirty {
            for raw in app.raw_out.drain(..) {
                term.write_raw(&raw);
            }
            term.terminal.draw(|frame| ui::draw(frame, &mut app))?;
            app.dirty = false;
        }
        tokio::select! {
            Some(ev) = key_rx.recv() => {
                app.on_term_event(ev);
                while let Ok(more) = key_rx.try_recv() {
                    app.on_term_event(more);
                }
            }
            Some(ev) = events.recv() => {
                if !remembered
                    && let Event::Ready(info) = &ev {
                        remember_room(info.link.as_deref().unwrap_or(&info.room));
                        remembered = true;
                    }
                app.on_engine_event(ev);
                while let Ok(more) = events.try_recv() {
                    app.on_engine_event(more);
                }
            }
            Some(msg) = msg_rx.recv() => app.on_msg(msg),
            _ = tick.tick() => app.on_tick(),
            _ = &mut signal => break,
        }
        if app.quit {
            break;
        }
    }
    stop.store(true, Ordering::SeqCst);
    session.stop();
    Ok(())
}
