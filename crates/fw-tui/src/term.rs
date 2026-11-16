//! Terminal lifecycle. Only sequences that the desktop widget documents as supported are emitted:
//! alternate screen, bracketed paste and SGR mouse (modes 1000 + 1006 only; no "any motion" 1003,
//! no kitty keyboard protocol, no focus events, no OSC queries).

use fw_core::Result;
use ratatui::Terminal;
use ratatui::backend::CrosstermBackend;
use ratatui::crossterm::event::{self, Event as CtEvent};
use ratatui::crossterm::terminal::{EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode};
use ratatui::crossterm::{cursor, execute};
use std::io::{Stdout, Write, stdout};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Once};
use std::time::Duration;
use tokio::sync::mpsc::UnboundedSender;

const MOUSE_ON: &str = "\x1b[?1000h\x1b[?1006h";
const MOUSE_OFF: &str = "\x1b[?1006l\x1b[?1000l";
const PASTE_ON: &str = "\x1b[?2004h";
const PASTE_OFF: &str = "\x1b[?2004l";

static MOUSE: AtomicBool = AtomicBool::new(false);

fn restore_terminal() {
    let mut out = stdout();
    let mouse_off = if MOUSE.load(Ordering::SeqCst) { MOUSE_OFF } else { "" };
    let _ = write!(out, "{mouse_off}{PASTE_OFF}\x1b[0m");
    let _ = execute!(out, cursor::Show, LeaveAlternateScreen);
    let _ = disable_raw_mode();
    let _ = out.flush();
}

fn install_panic_hook() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            restore_terminal();
            previous(info);
        }));
    });
}

/// RAII guard: restores the terminal on drop, on panic and on early return.
pub struct Term {
    pub terminal: Terminal<CrosstermBackend<Stdout>>,
}

impl Term {
    pub fn enter(mouse: bool) -> Result<Term> {
        install_panic_hook();
        enable_raw_mode()?;
        let mut out = stdout();
        execute!(out, EnterAlternateScreen, cursor::Hide)?;
        write!(out, "{PASTE_ON}")?;
        if mouse {
            MOUSE.store(true, Ordering::SeqCst);
            write!(out, "{MOUSE_ON}")?;
        }
        out.flush()?;
        let terminal = Terminal::new(CrosstermBackend::new(out))?;
        Ok(Term { terminal })
    }

    /// Writes raw bytes (e.g. an OSC 52 sequence) straight to the terminal.
    pub fn write_raw(&mut self, text: &str) {
        let mut out = stdout();
        let _ = write!(out, "{text}");
        let _ = out.flush();
    }
}

impl Drop for Term {
    fn drop(&mut self) {
        restore_terminal();
    }
}

/// Reads terminal events on a dedicated thread and forwards them until `stop` is set.
pub fn spawn_input(tx: UnboundedSender<CtEvent>, stop: Arc<AtomicBool>) {
    std::thread::spawn(move || {
        while !stop.load(Ordering::SeqCst) {
            match event::poll(Duration::from_millis(200)) {
                Ok(true) => match event::read() {
                    Ok(ev) => {
                        if tx.send(ev).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                },
                Ok(false) => {}
                Err(_) => break,
            }
        }
    });
}
