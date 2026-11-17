//! `4w update`: finds the latest version, downloads the installer of that release tag, verifies its
//! minisign signature against the embedded release key and only then runs it. Also the once-a-day
//! background check that prints a one-line notice on stderr.

use crate::args::{self, flag};
use crate::util::exact;
use fw_core::lang::{self, Lang, trs};
use fw_core::signing::{RELEASE_PUBKEYS, verify_minisig};
use fw_core::url::{assert_safe_url, is_loopback};
use fw_core::{Error, ErrorKind, Result, config, http, version};
use serde_json::{Map, Value, json};
use std::time::Duration;

const DEFAULT_VERSION_URL: &str = "https://raw.githubusercontent.com/4words/4w-cli/main/package.json";

fn version_url() -> Result<String> {
    let raw = std::env::var("FOURWORDS_UPDATE_URL").ok().filter(|v| !v.is_empty()).unwrap_or_else(|| DEFAULT_VERSION_URL.to_string());
    Ok(assert_safe_url(&raw, "FOURWORDS_UPDATE_URL")?.to_string())
}

/// Latest released version, read from `package.json` of the default branch (kept for older clients).
pub async fn latest_version(timeout: Duration) -> Result<String> {
    let url = version_url()?;
    let response = http::client().get(url).timeout(timeout).send().await.map_err(|e| http::network_error(e, "update"))?;
    let status = response.status().as_u16();
    if !(200..300).contains(&status) {
        return Err(Error::new(
            ErrorKind::Http(status),
            trs(
                format!("Failed to check for updates (HTTP {status})."),
                format!("Falha ao verificar atualizações (HTTP {status})."),
                format!("Error al verificar actualizaciones (HTTP {status})."),
            ),
        ));
    }
    let bytes = http::read_limited(response, 1024 * 1024).await?;
    let data: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    data.get("version").and_then(Value::as_str).map(str::to_string).ok_or_else(|| {
        Error::protocol(trs(
            "Invalid release metadata received from repository.",
            "Metadados de release inválidos recebidos do repositório.",
            "Metadatos de versión no válidos recibidos del repositorio.",
        ))
    })
}

pub async fn command(rest: &[String]) -> Result<Value> {
    let p = args::parse(rest, &[flag("check"), flag("force")])?;
    exact(&p.positionals, 0, "update [--check] [--force]")?;
    handle(p.flag("check"), p.flag("force")).await
}

async fn handle(check: bool, force: bool) -> Result<Value> {
    let current = fw_core::VERSION;
    let latest = latest_version(Duration::from_secs(30)).await?;
    let newer = version::is_newer(&latest, current);
    if check {
        let message = if newer {
            trs(
                format!("A new version of 4w is available ({current} -> {latest}). Run '4w update' to install."),
                format!("Uma nova versão do 4w está disponível ({current} -> {latest}). Execute '4w update' para instalar."),
                format!("Hay una nueva versión de 4w disponible ({current} -> {latest}). Ejecute '4w update' para instalar."),
            )
        } else {
            trs(
                format!("4w is already at the latest version ({current})."),
                format!("O 4w já está na versão mais recente ({current})."),
                format!("4w ya está en la versión más reciente ({current})."),
            )
        };
        let mut out = Map::new();
        out.insert("ok".into(), json!(true));
        out.insert("current_version".into(), json!(current));
        out.insert("latest_version".into(), json!(latest));
        out.insert("update_available".into(), json!(newer));
        if newer {
            out.insert("command".into(), json!("4w update"));
        }
        out.insert("message".into(), json!(message));
        return Ok(Value::Object(out));
    }
    if !newer && !force {
        return Ok(json!({
            "ok": true,
            "current_version": current,
            "latest_version": latest,
            "update_available": false,
            "message": trs(
                format!("4w is already at the latest version ({current}). Use --force to reinstall."),
                format!("O 4w já está na versão mais recente ({current}). Use --force para reinstalar."),
                format!("4w ya está en la versión más reciente ({current}). Use --force para reinstalar."),
            ),
        }));
    }
    let output = run_installer(&latest, false).await?;
    Ok(json!({
        "ok": true,
        "previous_version": current,
        "updated_version": latest,
        "message": trs(
            format!("Successfully updated 4w from {current} to {latest}."),
            format!("4w atualizado com sucesso de {current} para {latest}."),
            format!("4w actualizado con éxito de {current} a {latest}."),
        ),
        "output": output.trim(),
    }))
}

fn signature_error(why: &str) -> Error {
    Error::new(
        ErrorKind::Crypto,
        trs(
            format!("Installer signature verification failed ({why}). Update aborted."),
            format!("A verificação da assinatura do instalador falhou ({why}). Atualização abortada."),
            format!("La verificación de la firma del instalador falló ({why}). Actualización abortada."),
        ),
    )
}

async fn download(url: &str) -> Result<Vec<u8>> {
    let response =
        http::client().get(url).timeout(Duration::from_secs(120)).send().await.map_err(|e| http::network_error(e, "installer"))?;
    let status = response.status().as_u16();
    if !(200..300).contains(&status) {
        return Err(Error::new(
            ErrorKind::Http(status),
            trs(
                format!("Failed to download installer from {url} (HTTP {status})."),
                format!("Falha ao baixar o instalador de {url} (HTTP {status})."),
                format!("Error al descargar el instalador desde {url} (HTTP {status})."),
            ),
        ));
    }
    http::read_limited(response, 4 * 1024 * 1024).await
}

async fn run_installer(latest: &str, uninstall: bool) -> Result<String> {
    let windows = cfg!(windows);
    let file = if windows { "install.ps1" } else { "install.sh" };
    let default_url = format!("https://raw.githubusercontent.com/4words/4w-cli/v{latest}/{file}");
    let raw = std::env::var("FOURWORDS_INSTALLER_URL").ok().filter(|v| !v.is_empty()).unwrap_or(default_url);
    let url = assert_safe_url(&raw, "FOURWORDS_INSTALLER_URL")?;

    let mut temp: Option<std::path::PathBuf> = None;
    let script = match std::env::var("FOURWORDS_INSTALLER_SCRIPT").ok().filter(|v| !v.is_empty()) {
        Some(path) => {
            if !std::path::Path::new(&path).is_file() {
                return Err(Error::usage(trs(
                    "FOURWORDS_INSTALLER_SCRIPT must point to an existing regular file.",
                    "FOURWORDS_INSTALLER_SCRIPT deve apontar para um arquivo regular existente.",
                    "FOURWORDS_INSTALLER_SCRIPT debe apuntar a un archivo regular existente.",
                )));
            }
            std::path::PathBuf::from(path)
        }
        None => {
            let body = download(url.as_str()).await?;
            let sig = match download(&format!("{url}.minisig")).await {
                Ok(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
                Err(e) => return Err(signature_error(&format!("missing signature at {url}.minisig ({e})"))),
            };
            // The test-only key override is honored exclusively on loopback installers.
            let override_key = std::env::var("FOURWORDS_UPDATE_PUBKEY").ok().filter(|k| !k.is_empty());
            let keys: Vec<&str> = match (&override_key, is_loopback(&url)) {
                (Some(k), true) => vec![k.as_str()],
                _ => RELEASE_PUBKEYS.to_vec(),
            };
            verify_minisig(&body, &sig, &keys)?;
            let dir = std::env::temp_dir().join(format!("4w-update-{}-{}", std::process::id(), config::now_ms()));
            fw_core::fsutil::create_private_dir(&dir)?;
            let path = dir.join(file);
            fw_core::fsutil::write_private(&path, &body)?;
            temp = Some(dir);
            path
        }
    };
    let result = {
        let mut command = if windows {
            let mut c = tokio::process::Command::new("powershell.exe");
            c.args(["-ExecutionPolicy", "Bypass", "-File"]).arg(&script);
            if uninstall {
                c.arg("-Uninstall");
            }
            c
        } else {
            let mut c = tokio::process::Command::new("sh");
            c.arg(&script);
            if uninstall {
                c.arg("--uninstall");
            }
            c
        };
        command.output().await
    };
    if let Some(dir) = temp {
        let _ = std::fs::remove_dir_all(dir);
    }
    let out = result?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let message = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("Installer exited with code {:?}", out.status.code())
        };
        return Err(Error::other(trs(
            format!("Update failed: {message}"),
            format!("Atualização falhou: {message}"),
            format!("La actualización falló: {message}"),
        )));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Once a day (TTY only, never in CI), checks for a newer release and prints a one-line notice.
/// Returns a handle so the caller can give the network call a moment to finish before exiting.
pub fn spawn_notice_check() -> Option<tokio::task::JoinHandle<()>> {
    use std::io::IsTerminal;
    if std::env::var("FOURWORDS_NO_UPDATE_CHECK").as_deref() == Ok("1") || std::env::var_os("CI").is_some() {
        return None;
    }
    if !std::io::stderr().is_terminal() && !std::io::stdin().is_terminal() {
        return None;
    }
    let cfg = config::read();
    let last = cfg.get("last_update_check").and_then(Value::as_u64).unwrap_or(0);
    let cached = cfg.get("cached_latest_version").and_then(Value::as_str).map(str::to_string);
    if let Some(latest) = &cached
        && version::is_newer(latest, fw_core::VERSION)
    {
        let current = fw_core::VERSION;
        let text = match lang::resolve() {
            Lang::PtBr => format!("[4w aviso] Nova versão disponível ({current} -> {latest}). Execute '4w update' para atualizar."),
            Lang::Es => format!("[4w aviso] Nueva versión disponible ({current} -> {latest}). Ejecute '4w update' para actualizar."),
            Lang::En => format!("[4w notice] A new version is available ({current} -> {latest}). Run '4w update' to update."),
        };
        eprintln!("\x1b[33m{text}\x1b[0m");
    }
    let now = config::now_ms();
    if now.saturating_sub(last) <= 24 * 60 * 60 * 1000 {
        return None;
    }
    Some(tokio::spawn(async move {
        if let Ok(latest) = latest_version(Duration::from_millis(1500)).await {
            let mut patch = Map::new();
            patch.insert("last_update_check".into(), json!(now));
            patch.insert("cached_latest_version".into(), json!(latest));
            let _ = config::update(patch);
        }
    }))
}

/// `4w uninstall --yes`: runs the signed installer of the installed version in uninstall mode (executable,
/// launcher link, PATH entries) and then erases the local vault and settings, wherever they live.
pub async fn uninstall(rest: &[String]) -> Result<Value> {
    let p = args::parse(rest, &[flag("yes")])?;
    exact(&p.positionals, 0, "uninstall --yes")?;
    if !p.flag("yes") {
        return Err(Error::usage(trs(
            "This removes 4w, its PATH entries, the local vault and settings. Run '4w uninstall --yes' to confirm.",
            "Isto remove o 4w, as entradas de PATH, o cofre local e as configurações. Execute '4w uninstall --yes' para confirmar.",
            "Esto elimina 4w, sus entradas de PATH, la bóveda local y los ajustes. Ejecute '4w uninstall --yes' para confirmar.",
        )));
    }
    let output = run_installer(fw_core::VERSION, true).await?;
    for path in [config::history_path(), config::config_path()].into_iter().flatten() {
        let _ = std::fs::remove_file(path);
    }
    Ok(json!({
        "ok": true,
        "uninstalled": true,
        "message": trs(
            "4w was removed from this user profile, including the vault and settings.",
            "O 4w foi removido deste perfil de usuário, incluindo cofre e configurações.",
            "4w se eliminó de este perfil de usuario, incluidos la bóveda y los ajustes.",
        ),
        "output": output.trim(),
    }))
}
