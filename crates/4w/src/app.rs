//! Process entry: global flags, help/version, routing to script commands or TUIs.

use crate::commands::{Ctx, Output, execute};
use crate::util::extract_global_notify;
use fw_core::lang::{self, Lang};
use fw_core::sanitize::raw_safe;
use fw_core::{Error, Result, config, help};
use serde_json::Value;
use std::io::{IsTerminal, Write};

/// Removes `--lang X` / `--lang=X` (before `--`), persists it and applies it for this process.
fn extract_global_lang(raw: &[String]) -> Result<Vec<String>> {
    let end = raw.iter().position(|a| a == "--").unwrap_or(raw.len());
    let mut out = Vec::new();
    let mut i = 0;
    let invalid = |value: &str| Error::usage(format!("Invalid language / Idioma inválido: {value}. Use: en, ptbr, es."));
    while i < end {
        let token = &raw[i];
        let value = if token == "--lang" {
            i += 1;
            Some(raw.get(i).map(String::as_str).unwrap_or(""))
        } else {
            token.strip_prefix("--lang=")
        };
        match value {
            Some(value) => {
                let target = lang::normalize(Some(value)).ok_or_else(|| invalid(value))?;
                let _ = config::save_lang(target);
                lang::set_override(target);
            }
            None => out.push(token.clone()),
        }
        i += 1;
    }
    out.extend(raw[end.min(raw.len())..].iter().cloned());
    Ok(out)
}

fn interactive() -> bool {
    std::io::stdin().is_terminal() && std::io::stdout().is_terminal() && std::env::var("TERM").as_deref() != Ok("dumb")
}

fn write_stdout(bytes: &[u8]) -> Result<()> {
    let mut out = std::io::stdout().lock();
    out.write_all(bytes)?;
    out.flush()?;
    Ok(())
}

pub async fn run(raw_args: Vec<String>) -> Result<()> {
    let notice = if raw_args.first().map(String::as_str) == Some("update") { None } else { crate::update::spawn_notice_check() };
    let result = run_inner(raw_args).await;
    if let Some(handle) = notice {
        let _ = tokio::time::timeout(std::time::Duration::from_millis(1600), handle).await;
    }
    result
}

async fn run_inner(raw_args: Vec<String>) -> Result<()> {
    let langed = extract_global_lang(&raw_args)?;
    let (args, notify) = extract_global_notify(&langed)?;
    if let Some(key) = notify {
        fw_core::mcp::set_default_notify(key);
    }
    if let Some(topic) = help::help_topic(&args) {
        println!("{}", help::help(Some(&topic), lang::resolve())?);
        return Ok(());
    }
    match args.first().map(String::as_str) {
        Some("--version" | "version") => {
            println!("4w {}", fw_core::VERSION);
            return Ok(());
        }
        Some("--self-test") => {
            if String::from_utf8("4Words ✓".as_bytes().to_vec()).as_deref() != Ok("4Words ✓") {
                return Err(Error::other("Self-test failed."));
            }
            println!("4w {} OK", fw_core::VERSION);
            return Ok(());
        }
        _ => {}
    }
    let first = args.first().map(String::as_str);
    if args.is_empty() || (args.len() == 1 && first == Some("tui")) {
        if interactive() {
            return launch_hub().await;
        }
        if !args.is_empty() {
            return Err(Error::usage(match lang::resolve() {
                Lang::En => "The interactive panel requires a TTY terminal. Use 4w --help for commands.",
                Lang::Es => "El panel necesita una terminal interactiva. Use 4w --help para ver los comandos.",
                Lang::PtBr => "O painel precisa de um terminal interativo. Use 4w --help para os comandos.",
            }));
        }
        println!("{}", help::help(None, lang::resolve())?);
        return Ok(());
    }
    if args.len() >= 2 && args[0] == "room" && (args[1] == "watch" || args[1] == "open") {
        return crate::watch::run(&args[2..]).await;
    }
    let mut args = args;
    if args.len() >= 2 && args[0] == "room" && args[1] == "create" {
        match crate::watch::create_and_open(&args[2..]).await? {
            Some(crate::commands::Output::Json(Value::Null)) => return Ok(()),
            Some(other) => return print_output(other),
            None => args.retain(|a| a != "--json"),
        }
    }
    print_output(execute(&args, &Ctx { input: None }).await?)
}

fn print_output(output: Output) -> Result<()> {
    match output {
        Output::Json(value) => {
            let mut text = serde_json::to_string_pretty(&value)?;
            text.push('\n');
            write_stdout(text.as_bytes())
        }
        Output::Raw { payload, .. } => {
            if std::io::stdout().is_terminal() {
                match payload.text {
                    Some(text) => write_stdout(raw_safe(&text).as_bytes()),
                    None => Err(Error::usage(match lang::resolve() {
                        Lang::PtBr => "Saída binária bloqueada no terminal. Use --output ARQUIVO ou redirecione o stdout.",
                        Lang::Es => "Salida binaria bloqueada en la terminal. Use --output ARCHIVO o redirija stdout.",
                        Lang::En => "Binary output blocked on a terminal. Use --output FILE or redirect stdout.",
                    })),
                }
            } else {
                match payload.text {
                    Some(text) => write_stdout(text.as_bytes()),
                    None => write_stdout(&payload.bytes),
                }
            }
        }
    }
}

/// Home screen loop: pick an action, open rooms in the workspace, come back to the hub afterwards.
async fn launch_hub() -> Result<()> {
    use fw_room::{Auth, RoomClient, SyncOptions};
    use fw_tui::hub::{Exec, HubOutcome, run_hub};
    use std::sync::Arc;
    let exec: Exec = Arc::new(|args, input| {
        Box::pin(async move {
            match execute(&args, &Ctx { input }).await? {
                Output::Json(value) => Ok(value),
                Output::Raw { meta, .. } => Ok(meta),
            }
        })
    });
    loop {
        match run_hub(exec.clone()).await? {
            HubOutcome::Quit => return Ok(()),
            HubOutcome::OpenRoom { room, admin_key } => {
                let mcp = fw_core::mcp::Mcp::new(None)?;
                mcp.ensure_ready(false).await?;
                let client = RoomClient::new(mcp, room.clone(), Auth::default());
                fw_tui::run_room(fw_tui::RoomLaunch {
                    client,
                    sync: SyncOptions::default(),
                    mouse: true,
                    owner_admin_key: admin_key,
                    vault_link: Some(room),
                })
                .await?;
            }
        }
    }
}
