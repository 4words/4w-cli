//! Script commands: every `4w COMMAND` that prints JSON. Behavior, flags and messages follow
//! the TypeScript CLI (`src/commands.ts`), which is the executable specification.

use crate::args::{self, Opt, flag, string, string_short};
use crate::getlink::{RawPayload, fetch_link};
use crate::util::*;
use fw_core::lang::{self, Lang, tr, trs};
use fw_core::mcp::Mcp;
use fw_core::{Error, Result, config, crypto, vault};
use serde_json::{Value, json};

pub struct Ctx {
    /// Replaces stdin for `-` arguments (used when a TUI drives the commands).
    pub input: Option<String>,
}

pub enum Output {
    Json(Value),
    /// `get --raw`: bytes/text written verbatim; `meta` is still recorded in the vault.
    Raw { meta: Value, payload: RawPayload },
}

const LLM_OPTS: [Opt; 4] = [string("llm-key"), string("llm-name"), string("key-file"), flag("from-history")];

fn with_llm(extra: &[Opt]) -> Vec<Opt> {
    let mut all = extra.to_vec();
    all.extend_from_slice(&LLM_OPTS);
    all
}

fn unknown_command(command: &str) -> Error {
    Error::usage(trs(
        format!("Unknown command: {command}. See 4w --help."),
        format!("Comando desconhecido: {command}. Consulte 4w --help."),
        format!("Comando desconocido: {command}. Consulte 4w --help."),
    ))
}

pub async fn execute(raw_args: &[String], ctx: &Ctx) -> Result<Output> {
    let (args, flag_notify) = extract_global_notify(raw_args)?;
    let notify = match flag_notify {
        Some(key) => Some(key),
        None => normalize_notify_key(std::env::var("FOURWORDS_NOTIFY_KEY").ok().as_deref())?,
    };
    let Some((command, rest)) = args.split_first() else {
        return Err(unknown_command("undefined"));
    };
    let output = match command.as_str() {
        "doctor" => doctor(rest, notify).await?,
        "update" => crate::update::command(rest).await?,
        "lang" => lang_command(rest)?,
        "history" => history_command(rest)?,
        "get" => return get_command(rest, notify).await,
        "delete" => {
            exact(rest, 1, "delete DELETE_URL")?;
            let mcp = ready(notify, false).await?;
            mcp.call("delete_content", json!({ "delete_url": rest[0] })).await?
        }
        "text" => text_command(rest, ctx, notify).await?,
        "file" => file_command(rest, notify).await?,
        "room" => room_command(rest, ctx, notify).await?,
        "mcp" => mcp_command(rest, ctx, notify).await?,
        other => return Err(unknown_command(other)),
    };
    let full = match (command.as_str(), rest.first()) {
        ("room", Some(action)) => format!("room {action}"),
        _ => command.clone(),
    };
    vault::save_entry(&full, &output);
    Ok(Output::Json(output))
}

async fn ready(notify: Option<String>, force: bool) -> Result<Mcp> {
    let mcp = Mcp::new(notify)?;
    mcp.ensure_ready(force).await?;
    Ok(mcp)
}

async fn doctor(rest: &[String], notify: Option<String>) -> Result<Value> {
    exact(rest, 0, "doctor")?;
    let mcp = ready(notify, true).await?;
    let tools = mcp.list().await?;
    Ok(json!({ "ok": true, "version": fw_core::VERSION, "tools": tools.len() }))
}

fn lang_command(rest: &[String]) -> Result<Value> {
    if rest.len() > 1 {
        return Err(usage("lang [en|ptbr|es]"));
    }
    let available = json!(["en", "ptbr", "es"]);
    let path = |p: Option<std::path::PathBuf>| p.map(|p| Value::String(p.to_string_lossy().into_owned())).unwrap_or(Value::Null);
    let Some(wanted) = rest.first() else {
        return Ok(json!({
            "ok": true,
            "lang": lang::resolve().code(),
            "saved": config::saved_lang().map(|l| Value::String(l.code().into())).unwrap_or(Value::Null),
            "available": available,
            "config_file": path(config::config_path()),
        }));
    };
    let Some(target) = lang::normalize(Some(wanted)) else {
        return Err(Error::usage(format!("Invalid language / Idioma inválido: {wanted}. Use: en, ptbr, es.")));
    };
    let file = config::save_lang(target)?;
    let message = match target {
        Lang::En => "Default language updated and saved on this machine: English (en).",
        Lang::PtBr => "Idioma padrão alterado e salvo nesta máquina: Português (ptbr).",
        Lang::Es => "Idioma predeterminado cambiado y guardado en esta máquina: Español (es).",
    };
    Ok(json!({
        "ok": true, "lang": target.code(), "saved": true, "available": available,
        "config_file": path(file), "message": message,
    }))
}

fn history_command(rest: &[String]) -> Result<Value> {
    let p = args::parse(rest, &[flag("clear")])?;
    exact(&p.positionals, 0, "history [--clear]")?;
    if p.flag("clear") {
        vault::clear();
        return Ok(json!({ "ok": true, "cleared": true }));
    }
    let items = vault::load();
    Ok(json!({ "ok": true, "count": items.len(), "items": items }))
}

async fn get_command(rest: &[String], notify: Option<String>) -> Result<Output> {
    let p = args::parse(rest, &[string_short("output", 'o'), flag("raw"), string("key")])?;
    exact(&p.positionals, 1, "get LINK_OR_COMBO [--output FILE] [--raw] [--key KEY]")?;
    let mcp = Mcp::new(notify)?;
    let (meta, raw) = fetch_link(&mcp, &p.positionals[0], p.get("output"), p.flag("raw"), p.get("key")).await?;
    vault::save_entry("get", &meta);
    Ok(match raw {
        Some(payload) => Output::Raw { meta, payload },
        None => Output::Json(meta),
    })
}

/// Burn-after-reading is ON unless `--no-burn` is given.
fn burn_flag(p: &args::Parsed) -> bool {
    !p.flag("no-burn")
}

async fn text_command(rest: &[String], ctx: &Ctx, notify: Option<String>) -> Result<Value> {
    let p = args::parse(rest, &[flag("burn"), flag("no-burn"), flag("encrypt"), string("file")])?;
    let burn = burn_flag(&p);
    let encrypt = p.flag("encrypt");
    let path = p.get("file");
    exact(&p.positionals, if path.is_none() { 1 } else { 0 }, "text TEXT|-|--file FILE [--burn|--no-burn] [--encrypt]")?;
    let mut content = match (path, p.positionals.first()) {
        (Some(path), _) => read_text(path, 100_000, ctx.input.as_deref()).await?,
        (None, Some(arg)) if arg == "-" => read_text("-", 100_000, ctx.input.as_deref()).await?,
        (None, Some(arg)) => arg.clone(),
        (None, None) => String::new(),
    };
    if content.trim().is_empty() || content.len() > 100_000 {
        return Err(Error::usage(trs(
            "Provide UTF-8 text from 1 to 100,000 bytes.",
            "Informe texto UTF-8 de 1 a 100.000 bytes.",
            "Indique texto UTF-8 de 1 a 100.000 bytes.",
        )));
    }
    let mut key = None;
    if encrypt {
        let (payload, k) = crypto::encrypt_text(&content)?;
        content = payload;
        key = Some(k);
    }
    let mcp = ready(notify, false).await?;
    let out = mcp.call("upload_text", json!({ "content": content, "burn": burn })).await?;
    Ok(match key {
        Some(k) => crypto::attach_key_fragment(out, &k),
        None => out,
    })
}

fn file_stream_body(path: &str) -> Result<reqwest::Body> {
    let file = std::fs::File::open(path)?;
    let stream = tokio_util::io::ReaderStream::new(tokio::fs::File::from_std(file));
    Ok(reqwest::Body::wrap_stream(stream))
}

async fn file_command(rest: &[String], notify: Option<String>) -> Result<Value> {
    let p = args::parse(rest, &[flag("burn"), flag("no-burn"), flag("encrypt"), flag("stream"), string("type")])?;
    let burn = burn_flag(&p);
    let encrypt = p.flag("encrypt");
    exact(&p.positionals, 1, "file FILE [--burn|--no-burn] [--stream] [--encrypt] [--type MIME]")?;
    let path = p.positionals[0].as_str();
    let use_stream_flag = p.flag("stream");
    let mime = p.get("type");
    let size = file_stat_size(path, MAX_STREAM_FILE).await?;
    let content_type = mime.unwrap_or("application/octet-stream");
    let name = file_name(path);

    if !encrypt && (use_stream_flag || size > MAX_FILE) {
        let mcp = Mcp::new(notify)?;
        return mcp.upload_file_stream(&name, file_stream_body(path)?, Some(size), burn, content_type).await;
    }
    let raw = file_bytes(path, if encrypt { MAX_FILE - 64 } else { MAX_FILE }).await?;
    let (payload, key) = if encrypt {
        let (blob, key) = crypto::encrypt_file(&raw)?;
        (blob, Some(key))
    } else {
        (raw, None)
    };
    let out = if use_stream_flag {
        let mcp = Mcp::new(notify)?;
        let len = payload.len() as u64;
        mcp.upload_file_stream(&name, reqwest::Body::from(payload), Some(len), burn, content_type).await?
    } else {
        use base64::Engine;
        let mcp = ready(notify, false).await?;
        mcp.call(
            "upload_file",
            compact(vec![
                ("filename", s(&name)),
                ("content_base64", s(&base64::engine::general_purpose::STANDARD.encode(&payload))),
                ("content_type", opt_s(mime)),
                ("burn", Some(Value::Bool(burn))),
            ]),
        )
        .await?
    };
    Ok(match key {
        Some(k) => crypto::attach_key_fragment(out, &k),
        None => out,
    })
}

async fn mcp_command(rest: &[String], ctx: &Ctx, notify: Option<String>) -> Result<Value> {
    let usage_line = || Error::usage(format!("{}: 4w mcp list | 4w mcp call TOOL [JSON|-]", tr("Usage", "Uso", "Uso")));
    match rest.first().map(String::as_str) {
        Some("list") => {
            exact(rest, 1, "mcp list")?;
            let mcp = ready(notify, false).await?;
            Ok(Value::Array(mcp.list().await?))
        }
        Some("call") if (2..=3).contains(&rest.len()) => {
            let name = &rest[1];
            let raw = rest.get(2).map(String::as_str).unwrap_or("{}");
            let text = if raw == "-" { read_text("-", 40 * 1024 * 1024, ctx.input.as_deref()).await? } else { raw.to_string() };
            let params: Value = serde_json::from_str(&text).map_err(|e| Error::usage(e.to_string()))?;
            if !params.is_object() {
                return Err(Error::usage(trs("Expected a JSON object.", "Esperava um objeto JSON.", "Se esperaba un objeto JSON.")));
            }
            let mcp = ready(notify, false).await?;
            mcp.call(name, params).await
        }
        _ => Err(usage_line()),
    }
}

// ---- rooms ------------------------------------------------------------------------------------

fn auth_pairs(p: &args::Parsed, room: Option<&str>) -> Result<Vec<(&'static str, Option<Value>)>> {
    LlmFlags::from(p).resolve(room)
}

async fn room_command(rest: &[String], ctx: &Ctx, notify: Option<String>) -> Result<Value> {
    let Some((action, room_args)) = rest.split_first() else {
        return Err(Error::usage(trs(
            "Unknown room action. See 4w --help.",
            "Ação de sala desconhecida. Consulte 4w --help.",
            "Acción de sala desconocida. Consulte 4w --help.",
        )));
    };
    match action.as_str() {
        "create" => {
            let p = args::parse(room_args, &[string("doc"), string("message"), string("llm-name")])?;
            exact(&p.positionals, 0, "room create [--doc FILE] [--message TEXT] [--llm-name NAME]")?;
            let markdown = match p.get("doc") {
                Some(path) => Some(read_text(path, 200_000, ctx.input.as_deref()).await?),
                None => None,
            };
            if markdown.as_deref().is_some_and(|m| utf16_len(m) > 50_000) {
                return Err(markdown_too_long());
            }
            let llm_name = p.get("llm-name").map(str::to_string).or_else(|| std::env::var("FOURWORDS_LLM_NAME").ok().filter(|v| !v.is_empty()));
            let args = compact(vec![
                ("initial_markdown", markdown.map(Value::String)),
                ("initial_message", opt_s(p.get("message"))),
                ("llm_name", llm_name.map(Value::String)),
            ]);
            ready(notify, false).await?.call("chat_create", args).await
        }
        "messages" => {
            let p = args::parse(room_args, &with_llm(&[string("since"), flag("mentions-only"), string("nick")]))?;
            exact(&p.positionals, 1, "room messages ROOM [--since N] [--mentions-only] [--nick NICK]")?;
            let room = p.positionals[0].as_str();
            let mut pairs = vec![
                ("url", s(room)),
                ("since", parse_non_negative_int(p.get("since"), "--since")?.map(Value::from)),
                ("mentions_only", p.flag("mentions-only").then_some(Value::Bool(true))),
                ("nick", opt_s(p.get("nick"))),
            ];
            pairs.extend(auth_pairs(&p, Some(room))?);
            ready(notify, false).await?.call("chat_messages", compact(pairs)).await
        }
        "join" | "doc" | "participants" | "nick" => {
            let p = args::parse(room_args, &LLM_OPTS)?;
            exact(&p.positionals, 1, &format!("room {action} ROOM"))?;
            let room = p.positionals[0].as_str();
            let tool = match action.as_str() {
                "join" => "chat_join",
                "doc" => "chat_get_doc",
                "participants" => "chat_participants",
                _ => "chat_roll_nick",
            };
            let mut pairs = vec![("url", s(room))];
            pairs.extend(auth_pairs(&p, Some(room))?);
            ready(notify, false).await?.call(tool, compact(pairs)).await
        }
        "register-llm" => {
            let p = args::parse(room_args, &LLM_OPTS)?;
            exact(&p.positionals, 1, "room register-llm ROOM --llm-key KEY [--llm-name NAME]")?;
            let room = p.positionals[0].as_str();
            let auth = auth_pairs(&p, Some(room))?;
            let has_key = auth.iter().any(|(k, v)| *k == "llm_key" && v.as_ref().and_then(Value::as_str).is_some_and(|s| !s.trim().is_empty()));
            if !has_key {
                return Err(Error::usage(trs(
                    "Provide --llm-key or set FOURWORDS_LLM_KEY.",
                    "Informe --llm-key ou defina FOURWORDS_LLM_KEY.",
                    "Indique --llm-key o defina FOURWORDS_LLM_KEY.",
                )));
            }
            let mut pairs = vec![("url", s(room))];
            pairs.extend(auth);
            ready(notify, false).await?.call("chat_register_llm", compact(pairs)).await
        }
        "send" => {
            let p = args::parse(room_args, &with_llm(&[string("nick")]))?;
            exact(&p.positionals, 2, "room send ROOM TEXT [--nick NICK]")?;
            let room = p.positionals[0].as_str();
            let mut pairs = vec![("url", s(room)), ("text", s(&p.positionals[1])), ("nick", opt_s(p.get("nick")))];
            pairs.extend(auth_pairs(&p, Some(room))?);
            ready(notify, false).await?.call("chat_send", compact(pairs)).await
        }
        "send-file" => {
            use base64::Engine;
            let p = args::parse(room_args, &with_llm(&[string("text"), string("nick"), flag("burn"), flag("no-burn")]))?;
            exact(&p.positionals, 2, "room send-file ROOM FILE [--text MESSAGE] [--burn|--no-burn]")?;
            let room = p.positionals[0].as_str();
            let file = p.positionals[1].as_str();
            let bytes = file_bytes(file, MAX_FILE).await?;
            let mut pairs = vec![
                ("url", s(room)),
                ("filename", s(&file_name(file))),
                ("content_base64", s(&base64::engine::general_purpose::STANDARD.encode(bytes))),
                ("text", opt_s(p.get("text"))),
                ("nick", opt_s(p.get("nick"))),
                ("burn", Some(Value::Bool(burn_flag(&p)))),
            ];
            pairs.extend(auth_pairs(&p, Some(room))?);
            ready(notify, false).await?.call("chat_send_file", compact(pairs)).await
        }
        "save" => room_save(room_args, ctx, notify).await,
        "wait" => {
            let p = args::parse(
                room_args,
                &with_llm(&[string("since"), string("since-doc"), flag("no-watch-doc"), string("timeout"), flag("mentions-only"), flag("all"), string("nick")]),
            )?;
            exact(&p.positionals, 1, "room wait ROOM [--since N] [--since-doc TS] [--timeout S] [--all]")?;
            let room = p.positionals[0].as_str();
            let timeout = parse_non_negative_int(p.get("timeout"), "--timeout")?;
            if timeout.is_some_and(|t| !(1..=25).contains(&t)) {
                return Err(Error::usage(trs(
                    "--timeout must be between 1 and 25 seconds.",
                    "--timeout deve estar entre 1 e 25 segundos.",
                    "--timeout debe estar entre 1 y 25 segundos.",
                )));
            }
            let mentions_only = if p.flag("all") { Some(Value::Bool(false)) } else { p.flag("mentions-only").then_some(Value::Bool(true)) };
            let mut pairs = vec![
                ("url", s(room)),
                ("since", parse_non_negative_int(p.get("since"), "--since")?.map(Value::from)),
                ("since_doc_ts", parse_non_negative_int(p.get("since-doc"), "--since-doc")?.map(Value::from)),
                ("watch_doc", p.flag("no-watch-doc").then_some(Value::Bool(false))),
                ("timeout_seconds", timeout.map(Value::from)),
                ("mentions_only", mentions_only),
                ("nick", opt_s(p.get("nick"))),
            ];
            pairs.extend(auth_pairs(&p, Some(room))?);
            ready(notify, false).await?.call("chat_wait_events", compact(pairs)).await
        }
        "moderate" => {
            let p = args::parse(
                room_args,
                &with_llm(&[string("admin-key"), string("admin-key-file"), string("nick"), string("ban-id")]),
            )?;
            exact(&p.positionals, 2, "room moderate ROOM <ban|unban|list|verify> --admin-key KEY [--nick NICK] [--ban-id ID]")?;
            let (room, action) = (p.positionals[0].as_str(), p.positionals[1].as_str());
            if !["ban", "unban", "list", "verify"].contains(&action) {
                return Err(Error::usage(trs(
                    "Invalid moderation action. Use ban, unban, list, or verify.",
                    "Ação de moderação inválida. Use ban, unban, list ou verify.",
                    "Acción de moderación inválida. Use ban, unban, list o verify.",
                )));
            }
            let admin_key = match (p.get("admin-key"), p.get("admin-key-file")) {
                (Some(k), _) => Some(k.to_string()),
                (None, Some(path)) => Some(fw_core::secrets::read_secret_file(path, "--admin-key-file")?.to_string()),
                (None, None) => std::env::var("FOURWORDS_ADMIN_KEY").ok(),
            };
            let Some(admin_key) = admin_key.filter(|k| !k.trim().is_empty()) else {
                return Err(Error::usage(trs(
                    "Provide --admin-key, --admin-key-file, or set FOURWORDS_ADMIN_KEY.",
                    "Informe --admin-key, --admin-key-file ou defina FOURWORDS_ADMIN_KEY.",
                    "Indique --admin-key, --admin-key-file o defina FOURWORDS_ADMIN_KEY.",
                )));
            };
            let mut pairs = vec![
                ("url", s(room)),
                ("action", s(action)),
                ("admin_key", s(&admin_key)),
                ("nick", opt_s(p.get("nick"))),
                ("ban_id", opt_s(p.get("ban-id"))),
            ];
            pairs.extend(auth_pairs(&p, Some(room))?);
            ready(notify, false).await?.call("chat_moderate", compact(pairs)).await
        }
        _ => Err(Error::usage(trs(
            "Unknown room action. See 4w --help.",
            "Ação de sala desconhecida. Consulte 4w --help.",
            "Acción de sala desconocida. Consulte 4w --help.",
        ))),
    }
}

async fn room_save(room_args: &[String], ctx: &Ctx, notify: Option<String>) -> Result<Value> {
    let p = args::parse(
        room_args,
        &with_llm(&[string("base"), string("rollback-version"), string("rollback-ts"), flag("export-link"), string("nick")]),
    )?;
    let rollback_version = parse_non_negative_int(p.get("rollback-version"), "--rollback-version")?;
    let rollback_ts = parse_non_negative_int(p.get("rollback-ts"), "--rollback-ts")?;
    let is_rollback = rollback_version.is_some() || rollback_ts.is_some();
    let export = p.flag("export-link").then_some(Value::Bool(true));
    let save_usage = "room save ROOM [FILE] [--base N] [--rollback-version V | --rollback-ts TS]";
    if is_rollback {
        if p.positionals.is_empty() || p.positionals.len() > 2 {
            return Err(usage(save_usage));
        }
        let room = p.positionals[0].as_str();
        let base = parse_non_negative_int(p.get("base"), "--base")?;
        let content = match p.positionals.get(1) {
            Some(path) => Some(read_text(path, 200_000, ctx.input.as_deref()).await?),
            None => None,
        };
        if content.as_deref().is_some_and(|c| utf16_len(c) > 50_000) {
            return Err(markdown_too_long());
        }
        let mut pairs = vec![
            ("url", s(room)),
            ("content", content.map(Value::String)),
            ("base_updated_at", base.map(Value::from)),
            ("rollback_to_version", rollback_version.map(Value::from)),
            ("rollback_to_ts", rollback_ts.map(Value::from)),
            ("export_fourwords_link", export),
            ("nick", opt_s(p.get("nick"))),
        ];
        pairs.extend(auth_pairs(&p, Some(room))?);
        return ready(notify, false).await?.call("chat_save_doc", compact(pairs)).await;
    }
    exact(&p.positionals, 2, "room save ROOM FILE --base N")?;
    let base_raw = p.get("base");
    let base = match base_raw {
        Some(raw) if !raw.is_empty() && raw.bytes().all(|b| b.is_ascii_digit()) => raw.parse::<u64>().ok().filter(|n| *n <= 9_007_199_254_740_991),
        _ => None,
    };
    let Some(base) = base else {
        return Err(Error::usage(trs(
            "Provide --base with the updated_at from 4w room doc. Use 0 for an unrevised room.",
            "Informe --base com o updated_at de 4w room doc. Use 0 para uma sala sem revisão.",
            "Indique --base con el updated_at de 4w room doc. Use 0 para una sala sin revisión.",
        )));
    };
    let room = p.positionals[0].as_str();
    let content = read_text(&p.positionals[1], 200_000, ctx.input.as_deref()).await?;
    if utf16_len(&content) > 50_000 {
        return Err(markdown_too_long());
    }
    let mut pairs = vec![
        ("url", s(room)),
        ("content", Some(Value::String(content))),
        ("base_updated_at", Some(Value::from(base))),
        ("export_fourwords_link", export),
        ("nick", opt_s(p.get("nick"))),
    ];
    pairs.extend(auth_pairs(&p, Some(room))?);
    ready(notify, false).await?.call("chat_save_doc", compact(pairs)).await
}
