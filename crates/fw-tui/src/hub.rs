//! The home screen (`4w` with no arguments): rooms (new, open, recent), sharing and tools.
//! Commands run through an injected executor, so this crate does not depend on the CLI.

use crate::clip::{self, CopyResult};
use crate::term::{self, Term};
use crate::text::{clip as clip_text, fmt, wrap};
use crate::theme::Theme;
use fw_core::sanitize::{clean_line, json_masked, text_safe};
use fw_core::{Lang, Result, vault};
use ratatui::Frame;
use ratatui::crossterm::event::{Event as CtEvent, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Clear, Paragraph};
use ratatui_textarea::{TextArea, WrapMode};
use serde_json::Value;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tokio::sync::mpsc::{UnboundedSender, unbounded_channel};

/// Runs a CLI command (`["text", "-"]`, optional stdin) and returns its JSON result.
pub type Exec = Arc<dyn Fn(Vec<String>, Option<String>) -> Pin<Box<dyn Future<Output = Result<Value>> + Send>> + Send + Sync>;

#[derive(Debug, Clone, PartialEq)]
pub enum HubOutcome {
    Quit,
    OpenRoom { room: String, admin_key: Option<String> },
}

struct HubStrings {
    tagline: &'static str,
    sec_rooms: &'static str,
    sec_share: &'static str,
    sec_tools: &'static str,
    new_room: (&'static str, &'static str),
    open_room: (&'static str, &'static str),
    recent_desc: &'static str,
    publish_text: (&'static str, &'static str),
    publish_file: (&'static str, &'static str),
    fetch: (&'static str, &'static str),
    delete: (&'static str, &'static str),
    vault: (&'static str, &'static str),
    mcp: (&'static str, &'static str),
    doctor: (&'static str, &'static str),
    update: (&'static str, &'static str),
    language: (&'static str, &'static str),
    quit: (&'static str, &'static str),
    nav: &'static str,
    form_nav: &'static str,
    result_nav: &'static str,
    details: &'static str,
    menu: &'static str,
    f_markdown: &'static str,
    f_message: &'static str,
    f_agent: &'static str,
    f_room: &'static str,
    f_text: &'static str,
    f_file: &'static str,
    f_burn: &'static str,
    f_stream: &'static str,
    f_encrypt: &'static str,
    f_target: &'static str,
    f_output: &'static str,
    f_key: &'static str,
    f_delete_url: &'static str,
    f_json: &'static str,
    f_check: &'static str,
    f_force: &'static str,
    optional: &'static str,
    submit: &'static str,
    required: &'static str,
    busy: &'static str,
    response: &'static str,
    credentials_visible: &'static str,
    error: &'static str,
    copied: &'static str,
    no_clipboard: &'static str,
    confirm_delete: &'static str,
    mcp_tools: &'static str,
    mcp_empty: &'static str,
    owner: &'static str,
    ago: &'static str,
    resize: &'static str,
}

static EN: HubStrings = HubStrings {
    tagline: "Rooms  /  Sharing  /  Tools",
    sec_rooms: "ROOMS",
    sec_share: "SHARING",
    sec_tools: "TOOLS",
    new_room: ("New room", "Create a live room: chat, people, and a shared Markdown document, all in the terminal."),
    open_room: ("Open a room…", "Join any room with its link or four-word code."),
    recent_desc: "Reopen this room from the last 24 hours.",
    publish_text: ("Publish text", "Share text or Markdown with a four-word link. Burn-after-reading is on by default."),
    publish_file: ("Publish a file", "Share a file up to 24 MiB (or 1 GiB with streaming). Optional end-to-end encryption."),
    fetch: ("Fetch a link", "Read or download a four-word link; decrypts with the #key= secret."),
    delete: ("Destroy content", "Delete shared content immediately using its secret delete_url."),
    vault: ("Local vault (24 h)", "Credentials and links you created recently. Secrets stay hidden until you reveal them."),
    mcp: ("MCP explorer", "Browse the tools of the FourWords MCP server and call them with JSON."),
    doctor: ("Connection check", "Test the connection to FourWords and count the available tools."),
    update: ("Update 4w", "Check for a new version and update in place (signature verified)."),
    language: ("Language", "Switch the interface language (English, Português, Español)."),
    quit: ("Quit", "Close 4w."),
    nav: "↑↓ Navigate   Enter Open   L Language   ? Help   Esc Quit",
    form_nav: "Tab Fields   Ctrl+S Send   Space Toggle   Esc Back",
    result_nav: "↑↓ Scroll   V Credentials   Y Copy link   D Destroy   Esc Back",
    details: "Details",
    menu: "Menu",
    f_markdown: "Initial document (Markdown)",
    f_message: "Opening message",
    f_agent: "Agent name",
    f_room: "Room link or code",
    f_text: "Text or Markdown",
    f_file: "File path",
    f_burn: "Burn after reading",
    f_stream: "Streaming upload",
    f_encrypt: "Encrypt (AES-256-GCM)",
    f_target: "Link or four-word code",
    f_output: "Save to file",
    f_key: "Decryption key",
    f_delete_url: "Secret delete URL",
    f_json: "JSON arguments",
    f_check: "Only check (--check)",
    f_force: "Force reinstall (--force)",
    optional: "optional",
    submit: "Run",
    required: "Please fill in: {label}",
    busy: "Contacting FourWords…",
    response: "RESPONSE",
    credentials_visible: "RESPONSE · CREDENTIALS VISIBLE",
    error: "ERROR",
    copied: "Link sent to the clipboard",
    no_clipboard: "No clipboard available",
    confirm_delete: "Destroy this content now? Enter confirms, Esc cancels.",
    mcp_tools: "MCP tools ({n})",
    mcp_empty: "No tools returned.",
    owner: "owner",
    ago: "{t} ago",
    resize: "4w · enlarge the window",
};

static PT: HubStrings = HubStrings {
    tagline: "Salas  /  Compartilhamento  /  Ferramentas",
    sec_rooms: "SALAS",
    sec_share: "COMPARTILHAR",
    sec_tools: "FERRAMENTAS",
    new_room: ("Nova sala", "Crie uma sala ao vivo: chat, pessoas e um documento Markdown compartilhado, tudo no terminal."),
    open_room: ("Abrir uma sala…", "Entre em qualquer sala pelo link ou pelo código de quatro palavras."),
    recent_desc: "Reabra esta sala das últimas 24 horas.",
    publish_text: ("Publicar texto", "Compartilhe texto ou Markdown com um link de quatro palavras. Leitura única ligada por padrão."),
    publish_file: ("Publicar arquivo", "Compartilhe um arquivo de até 24 MiB (ou 1 GiB em streaming). Criptografia ponta a ponta opcional."),
    fetch: ("Buscar um link", "Leia ou baixe um link de quatro palavras; descriptografa com o segredo #key=."),
    delete: ("Destruir conteúdo", "Apague imediatamente um conteúdo usando o delete_url secreto."),
    vault: ("Cofre local (24 h)", "Credenciais e links criados recentemente. Segredos ficam ocultos até você revelar."),
    mcp: ("Explorador MCP", "Veja as ferramentas do servidor MCP do FourWords e chame-as com JSON."),
    doctor: ("Teste de conexão", "Teste a conexão com o FourWords e conte as ferramentas disponíveis."),
    update: ("Atualizar o 4w", "Verifique uma nova versão e atualize no lugar (assinatura verificada)."),
    language: ("Idioma", "Troque o idioma da interface (English, Português, Español)."),
    quit: ("Sair", "Fechar o 4w."),
    nav: "↑↓ Navegar   Enter Abrir   L Idioma   ? Ajuda   Esc Sair",
    form_nav: "Tab Campos   Ctrl+S Enviar   Espaço Alternar   Esc Voltar",
    result_nav: "↑↓ Rolar   V Credenciais   Y Copiar link   D Destruir   Esc Voltar",
    details: "Detalhes",
    menu: "Menu",
    f_markdown: "Documento inicial (Markdown)",
    f_message: "Mensagem de abertura",
    f_agent: "Nome do agente",
    f_room: "Link ou código da sala",
    f_text: "Texto ou Markdown",
    f_file: "Caminho do arquivo",
    f_burn: "Apagar após a leitura",
    f_stream: "Upload em streaming",
    f_encrypt: "Criptografar (AES-256-GCM)",
    f_target: "Link ou código de quatro palavras",
    f_output: "Salvar em arquivo",
    f_key: "Chave de descriptografia",
    f_delete_url: "URL secreta de exclusão",
    f_json: "Argumentos JSON",
    f_check: "Só verificar (--check)",
    f_force: "Forçar reinstalação (--force)",
    optional: "opcional",
    submit: "Executar",
    required: "Preencha: {label}",
    busy: "Conectando ao FourWords…",
    response: "RESPOSTA",
    credentials_visible: "RESPOSTA · CREDENCIAIS VISÍVEIS",
    error: "ERRO",
    copied: "Link enviado à área de transferência",
    no_clipboard: "Sem área de transferência",
    confirm_delete: "Destruir este conteúdo agora? Enter confirma, Esc cancela.",
    mcp_tools: "Ferramentas MCP ({n})",
    mcp_empty: "Nenhuma ferramenta retornada.",
    owner: "dono",
    ago: "há {t}",
    resize: "4w · amplie a janela",
};

static ES: HubStrings = HubStrings {
    tagline: "Salas  /  Compartir  /  Herramientas",
    sec_rooms: "SALAS",
    sec_share: "COMPARTIR",
    sec_tools: "HERRAMIENTAS",
    new_room: ("Nueva sala", "Cree una sala en vivo: chat, personas y un documento Markdown compartido, todo en la terminal."),
    open_room: ("Abrir una sala…", "Entre a cualquier sala con su enlace o código de cuatro palabras."),
    recent_desc: "Reabra esta sala de las últimas 24 horas.",
    publish_text: ("Publicar texto", "Comparta texto o Markdown con un enlace de cuatro palabras. Lectura única activada por defecto."),
    publish_file: ("Publicar archivo", "Comparta un archivo de hasta 24 MiB (o 1 GiB con streaming). Cifrado de extremo a extremo opcional."),
    fetch: ("Obtener un enlace", "Lea o descargue un enlace de cuatro palabras; descifra con el secreto #key=."),
    delete: ("Destruir contenido", "Elimine de inmediato un contenido con su delete_url secreto."),
    vault: ("Bóveda local (24 h)", "Credenciales y enlaces creados recientemente. Los secretos quedan ocultos hasta que los revele."),
    mcp: ("Explorador MCP", "Explore las herramientas del servidor MCP de FourWords y llámelas con JSON."),
    doctor: ("Prueba de conexión", "Pruebe la conexión con FourWords y cuente las herramientas disponibles."),
    update: ("Actualizar 4w", "Busque una nueva versión y actualice en el lugar (firma verificada)."),
    language: ("Idioma", "Cambie el idioma de la interfaz (English, Português, Español)."),
    quit: ("Salir", "Cerrar 4w."),
    nav: "↑↓ Navegar   Enter Abrir   L Idioma   ? Ayuda   Esc Salir",
    form_nav: "Tab Campos   Ctrl+S Enviar   Espacio Alternar   Esc Volver",
    result_nav: "↑↓ Desplazar   V Credenciales   Y Copiar enlace   D Destruir   Esc Volver",
    details: "Detalles",
    menu: "Menú",
    f_markdown: "Documento inicial (Markdown)",
    f_message: "Mensaje de apertura",
    f_agent: "Nombre del agente",
    f_room: "Enlace o código de la sala",
    f_text: "Texto o Markdown",
    f_file: "Ruta del archivo",
    f_burn: "Borrar tras la lectura",
    f_stream: "Subida por streaming",
    f_encrypt: "Cifrar (AES-256-GCM)",
    f_target: "Enlace o código de cuatro palabras",
    f_output: "Guardar en archivo",
    f_key: "Clave de descifrado",
    f_delete_url: "URL secreta de eliminación",
    f_json: "Argumentos JSON",
    f_check: "Solo verificar (--check)",
    f_force: "Forzar reinstalación (--force)",
    optional: "opcional",
    submit: "Ejecutar",
    required: "Complete: {label}",
    busy: "Conectando a FourWords…",
    response: "RESPUESTA",
    credentials_visible: "RESPUESTA · CREDENCIALES VISIBLES",
    error: "ERROR",
    copied: "Enlace enviado al portapapeles",
    no_clipboard: "Sin portapapeles",
    confirm_delete: "¿Destruir este contenido ahora? Enter confirma, Esc cancela.",
    mcp_tools: "Herramientas MCP ({n})",
    mcp_empty: "No se devolvieron herramientas.",
    owner: "dueño",
    ago: "hace {t}",
    resize: "4w · amplíe la ventana",
};

fn hs(lang: Lang) -> &'static HubStrings {
    match lang {
        Lang::En => &EN,
        Lang::PtBr => &PT,
        Lang::Es => &ES,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Act {
    NewRoom,
    OpenRoom,
    PublishText,
    PublishFile,
    Fetch,
    Delete,
    Vault,
    Mcp,
    Doctor,
    Update,
    Language,
    Quit,
}

#[derive(Debug, Clone)]
enum Item {
    Section(&'static str),
    Act(Act),
    Recent(vault::HistoryEntry),
}

enum Kind {
    Line,
    Multi,
    Toggle,
}

struct Field {
    id: &'static str,
    label: String,
    hint: String,
    kind: Kind,
    required: bool,
    line: crate::app::LineInput,
    area: TextArea<'static>,
    on: bool,
}

struct Form {
    act: Act,
    title: String,
    fields: Vec<Field>,
    focus: usize,
    error: Option<String>,
    tool: Option<String>,
}

struct Viewer {
    title: String,
    value: Value,
    text_cache: Option<(bool, Lang, Vec<String>)>,
    reveal: bool,
    scroll: usize,
    error: bool,
}

enum Screen {
    Menu,
    Form(Form),
    Busy(String),
    Viewer(Viewer),
    Mcp { tools: Vec<Value>, selected: usize },
    Confirm { url: String, back: Box<Viewer> },
}

enum Msg {
    Done { title: String, outcome: Result<Value>, act: Act },
    Tools(Result<Value>),
    Copied(CopyResult, String),
}

struct Hub {
    exec: Exec,
    tx: UnboundedSender<Msg>,
    theme: Theme,
    lang: Lang,
    items: Vec<Item>,
    sel: usize,
    screen: Screen,
    toast: Option<(String, std::time::Instant)>,
    dirty: bool,
    quit: Option<HubOutcome>,
    raw_out: Vec<String>,
}

fn field(id: &'static str, label: &str, hint: &str, kind: Kind, required: bool, initial_on: bool) -> Field {
    let mut area = TextArea::default();
    area.set_wrap_mode(WrapMode::WordOrGlyph);
    area.set_cursor_line_style(Style::default());
    Field { id, label: label.into(), hint: hint.into(), kind, required, line: Default::default(), area, on: initial_on }
}

fn ago(ms: u64, s: &HubStrings) -> String {
    let secs = fw_core::config::now_ms().saturating_sub(ms) / 1000;
    let t = if secs >= 3600 { format!("{}h", secs / 3600) } else if secs >= 60 { format!("{}m", secs / 60) } else { format!("{secs}s") };
    fmt(s.ago, &[("t", &t)])
}

impl Hub {
    fn s(&self) -> &'static HubStrings {
        hs(self.lang)
    }

    fn rebuild(&mut self) {
        let s = self.s();
        let mut items = vec![Item::Section(s.sec_rooms), Item::Act(Act::NewRoom), Item::Act(Act::OpenRoom)];
        for entry in vault::recent_rooms().into_iter().take(5) {
            items.push(Item::Recent(entry));
        }
        items.extend([
            Item::Section(s.sec_share),
            Item::Act(Act::PublishText),
            Item::Act(Act::PublishFile),
            Item::Act(Act::Fetch),
            Item::Act(Act::Delete),
            Item::Section(s.sec_tools),
            Item::Act(Act::Vault),
            Item::Act(Act::Mcp),
            Item::Act(Act::Doctor),
            Item::Act(Act::Update),
            Item::Act(Act::Language),
            Item::Act(Act::Quit),
        ]);
        self.items = items;
        if !matches!(self.items.get(self.sel), Some(Item::Act(_) | Item::Recent(_))) {
            self.sel = 1;
        }
    }

    fn act_info(&self, act: Act) -> (&'static str, &'static str) {
        let s = self.s();
        match act {
            Act::NewRoom => s.new_room,
            Act::OpenRoom => s.open_room,
            Act::PublishText => s.publish_text,
            Act::PublishFile => s.publish_file,
            Act::Fetch => s.fetch,
            Act::Delete => s.delete,
            Act::Vault => s.vault,
            Act::Mcp => s.mcp,
            Act::Doctor => s.doctor,
            Act::Update => s.update,
            Act::Language => s.language,
            Act::Quit => s.quit,
        }
    }

    fn toast(&mut self, text: impl Into<String>) {
        self.toast = Some((text.into(), std::time::Instant::now() + Duration::from_secs(4)));
        self.dirty = true;
    }

    fn move_sel(&mut self, delta: isize) {
        let len = self.items.len() as isize;
        let mut i = self.sel as isize;
        loop {
            i = (i + delta).rem_euclid(len);
            if matches!(self.items[i as usize], Item::Act(_) | Item::Recent(_)) {
                break;
            }
        }
        self.sel = i as usize;
    }

    fn open_form(&mut self, act: Act) {
        let s = self.s();
        let opt = s.optional;
        let (title, _) = self.act_info(act);
        let fields = match act {
            Act::NewRoom => vec![
                field("markdown", s.f_markdown, opt, Kind::Multi, false, false),
                field("message", s.f_message, opt, Kind::Line, false, false),
                field("llm_name", s.f_agent, opt, Kind::Line, false, false),
            ],
            Act::OpenRoom => vec![field("room", s.f_room, "lua-gato-sol-rio-123456789", Kind::Line, true, false)],
            Act::PublishText => vec![
                field("text", s.f_text, "", Kind::Multi, true, false),
                field("burn", s.f_burn, "", Kind::Toggle, false, true),
                field("encrypt", s.f_encrypt, "", Kind::Toggle, false, false),
            ],
            Act::PublishFile => vec![
                field("file", s.f_file, "~/report.pdf", Kind::Line, true, false),
                field("burn", s.f_burn, "", Kind::Toggle, false, true),
                field("stream", s.f_stream, "", Kind::Toggle, false, false),
                field("encrypt", s.f_encrypt, "", Kind::Toggle, false, false),
            ],
            Act::Fetch => vec![
                field("target", s.f_target, "lua-gato-sol-rio-123456789#key=…", Kind::Line, true, false),
                field("output", s.f_output, opt, Kind::Line, false, false),
                field("key", s.f_key, opt, Kind::Line, false, false),
            ],
            Act::Delete => vec![field("delete_url", s.f_delete_url, "https://4words.aletheia.land/d/…", Kind::Line, true, false)],
            Act::Update => vec![field("check", s.f_check, "", Kind::Toggle, false, true), field("force", s.f_force, "", Kind::Toggle, false, false)],
            _ => vec![],
        };
        self.screen = Screen::Form(Form { act, title: title.into(), fields, focus: 0, error: None, tool: None });
    }

    fn activate(&mut self) {
        match self.items.get(self.sel).cloned() {
            Some(Item::Act(act)) => match act {
                Act::Quit => self.quit = Some(HubOutcome::Quit),
                Act::Language => {
                    self.lang = self.lang.next();
                    fw_core::lang::set_override(self.lang);
                    let _ = fw_core::config::save_lang(self.lang);
                    self.rebuild();
                }
                Act::Vault => self.run(Act::Vault, vec!["history".into()], None),
                Act::Doctor => self.run(Act::Doctor, vec!["doctor".into()], None),
                Act::Mcp => {
                    self.screen = Screen::Busy(self.s().busy.into());
                    let exec = self.exec.clone();
                    let tx = self.tx.clone();
                    tokio::spawn(async move {
                        let _ = tx.send(Msg::Tools(exec(vec!["mcp".into(), "list".into()], None).await));
                    });
                }
                other => self.open_form(other),
            },
            Some(Item::Recent(entry)) => {
                let room = entry.link().unwrap_or_default().to_string();
                let admin_key = entry.admin_key.clone().or_else(|| vault::admin_key_for(&room));
                self.quit = Some(HubOutcome::OpenRoom { room, admin_key });
            }
            _ => {}
        }
    }

    fn run(&mut self, act: Act, args: Vec<String>, input: Option<String>) {
        let title = self.act_info(act).0.to_string();
        self.screen = Screen::Busy(title.clone());
        let exec = self.exec.clone();
        let tx = self.tx.clone();
        tokio::spawn(async move {
            let outcome = exec(args, input).await;
            let _ = tx.send(Msg::Done { title, outcome, act });
        });
    }

    fn submit(&mut self) {
        let s = self.s();
        let Screen::Form(form) = &mut self.screen else { return };
        let get = |id: &str| -> String {
            form.fields
                .iter()
                .find(|f| f.id == id)
                .map(|f| match f.kind {
                    Kind::Multi => f.area.lines().join("\n"),
                    _ => f.line.text.clone(),
                })
                .unwrap_or_default()
        };
        let on = |id: &str| form.fields.iter().find(|f| f.id == id).is_some_and(|f| f.on);
        if let Some(missing) = form.fields.iter().position(|f| f.required && (match f.kind { Kind::Multi => f.area.lines().join("\n"), _ => f.line.text.clone() }).trim().is_empty()) {
            form.focus = missing;
            form.error = Some(fmt(s.required, &[("label", &form.fields[missing].label)]));
            self.dirty = true;
            return;
        }
        let act = form.act;
        let burn = if on("burn") { "--burn" } else { "--no-burn" };
        let (args, input): (Vec<String>, Option<String>) = match act {
            Act::NewRoom => {
                let md = get("markdown");
                let mut a = vec!["room".to_string(), "create".to_string()];
                if !md.trim().is_empty() {
                    a.extend(["--doc".into(), "-".into()]);
                }
                if !get("message").trim().is_empty() {
                    a.extend(["--message".into(), get("message").trim().into()]);
                }
                if !get("llm_name").trim().is_empty() {
                    a.extend(["--llm-name".into(), get("llm_name").trim().into()]);
                }
                (a, (!md.trim().is_empty()).then_some(md))
            }
            Act::OpenRoom => {
                self.quit = Some(HubOutcome::OpenRoom { room: get("room").trim().to_string(), admin_key: None });
                return;
            }
            Act::PublishText => {
                let mut a = vec!["text".to_string(), burn.to_string()];
                if on("encrypt") {
                    a.push("--encrypt".into());
                }
                a.push("-".into());
                (a, Some(get("text")))
            }
            Act::PublishFile => {
                let mut a = vec!["file".to_string(), burn.to_string()];
                if on("stream") {
                    a.push("--stream".into());
                }
                if on("encrypt") {
                    a.push("--encrypt".into());
                }
                a.extend(["--".into(), crate::util::expand_home(get("file").trim())]);
                (a, None)
            }
            Act::Fetch => {
                let mut a = vec!["get".to_string(), get("target").trim().to_string()];
                if !get("output").trim().is_empty() {
                    a.extend(["--output".into(), crate::util::expand_home(get("output").trim())]);
                }
                if !get("key").trim().is_empty() {
                    a.extend(["--key".into(), get("key").trim().into()]);
                }
                (a, None)
            }
            Act::Delete => {
                let url = get("delete_url").trim().to_string();
                let back = Viewer { title: s.delete.0.into(), value: Value::Null, text_cache: None, reveal: false, scroll: 0, error: false };
                self.screen = Screen::Confirm { url, back: Box::new(back) };
                return;
            }
            Act::Update => {
                let mut a = vec!["update".to_string()];
                if on("check") {
                    a.push("--check".into());
                }
                if on("force") {
                    a.push("--force".into());
                }
                (a, None)
            }
            Act::Mcp => {
                let name = form.tool.clone().unwrap_or_default();
                (vec!["mcp".into(), "call".into(), name, "-".into()], Some(get("json")))
            }
            _ => return,
        };
        self.run(act, args, input);
    }

    fn on_msg(&mut self, msg: Msg) {
        self.dirty = true;
        match msg {
            Msg::Done { title, outcome, act } => match outcome {
                Ok(value) => {
                    if act == Act::NewRoom {
                        let room = value.get("fourwords_url").or_else(|| value.get("url")).and_then(Value::as_str).map(str::to_string);
                        if let Some(room) = room {
                            let admin_key = value.get("admin_key").and_then(Value::as_str).map(str::to_string);
                            self.quit = Some(HubOutcome::OpenRoom { room, admin_key });
                            return;
                        }
                    }
                    self.screen = Screen::Viewer(Viewer { title, value, text_cache: None, reveal: false, scroll: 0, error: false });
                    self.rebuild();
                }
                Err(e) => {
                    self.screen = Screen::Viewer(Viewer { title: self.s().error.into(), value: Value::String(e.to_string()), text_cache: None, reveal: false, scroll: 0, error: true });
                }
            },
            Msg::Tools(result) => match result {
                Ok(Value::Array(tools)) if !tools.is_empty() => self.screen = Screen::Mcp { tools, selected: 0 },
                Ok(_) => self.screen = Screen::Viewer(Viewer { title: self.s().mcp.0.into(), value: Value::String(self.s().mcp_empty.into()), text_cache: None, reveal: false, scroll: 0, error: false }),
                Err(e) => self.screen = Screen::Viewer(Viewer { title: self.s().error.into(), value: Value::String(e.to_string()), text_cache: None, reveal: false, scroll: 0, error: true }),
            },
            Msg::Copied(result, text) => match result {
                CopyResult::Tool(_) => self.toast(self.s().copied),
                CopyResult::Osc52 => {
                    self.raw_out.push(clip::osc52(&text));
                    self.toast(self.s().copied);
                }
                CopyResult::Unavailable => self.toast(self.s().no_clipboard),
            },
        }
    }

    fn key(&mut self, key: KeyEvent) {
        self.dirty = true;
        let ctrl = key.modifiers.contains(KeyModifiers::CONTROL);
        if ctrl && key.code == KeyCode::Char('c') {
            self.quit = Some(HubOutcome::Quit);
            return;
        }
        match &mut self.screen {
            Screen::Menu => match key.code {
                KeyCode::Up | KeyCode::Char('k') => self.move_sel(-1),
                KeyCode::Down | KeyCode::Char('j') => self.move_sel(1),
                KeyCode::Enter => self.activate(),
                KeyCode::Char('l') | KeyCode::Char('L') => {
                    self.lang = self.lang.next();
                    fw_core::lang::set_override(self.lang);
                    let _ = fw_core::config::save_lang(self.lang);
                    self.rebuild();
                }
                KeyCode::Esc | KeyCode::Char('q') => self.quit = Some(HubOutcome::Quit),
                _ => {}
            },
            Screen::Form(form) => {
                let last = form.fields.len();
                match key.code {
                    KeyCode::Esc => self.screen = Screen::Menu,
                    KeyCode::Char('s') if ctrl => self.submit(),
                    KeyCode::F(2) => self.submit(),
                    KeyCode::Tab => form.focus = (form.focus + 1) % (last + 1),
                    KeyCode::BackTab => form.focus = (form.focus + last) % (last + 1),
                    _ => {
                        if form.focus == last {
                            if key.code == KeyCode::Enter {
                                self.submit();
                            }
                            return;
                        }
                        let multi = matches!(form.fields[form.focus].kind, Kind::Multi);
                        let f = &mut form.fields[form.focus];
                        match f.kind {
                            Kind::Toggle => {
                                if matches!(key.code, KeyCode::Char(' ') | KeyCode::Enter) {
                                    f.on = !f.on;
                                }
                            }
                            Kind::Multi => {
                                f.area.input(key);
                            }
                            Kind::Line => {
                                if key.code == KeyCode::Enter {
                                    form.focus += 1;
                                } else {
                                    f.line.key(&key);
                                }
                            }
                        }
                        let _ = multi;
                        form.error = None;
                    }
                }
            }
            Screen::Busy(_) => {
                if key.code == KeyCode::Esc {
                    self.screen = Screen::Menu;
                }
            }
            Screen::Viewer(v) => match key.code {
                KeyCode::Esc | KeyCode::Char('q') => {
                    self.screen = Screen::Menu;
                }
                KeyCode::Up | KeyCode::Char('k') => v.scroll = v.scroll.saturating_sub(1),
                KeyCode::Down | KeyCode::Char('j') => v.scroll += 1,
                KeyCode::PageUp => v.scroll = v.scroll.saturating_sub(10),
                KeyCode::PageDown => v.scroll += 10,
                KeyCode::Home => v.scroll = 0,
                KeyCode::Char('v') | KeyCode::Char('V') if !v.error => {
                    v.reveal = !v.reveal;
                    v.text_cache = None;
                }
                KeyCode::Char('y') | KeyCode::Char('Y') => {
                    if let Some(link) = public_link(&v.value) {
                        let tx = self.tx.clone();
                        tokio::spawn(async move {
                            let result = clip::copy(&link).await;
                            let _ = tx.send(Msg::Copied(result, link));
                        });
                    }
                }
                KeyCode::Char('d') | KeyCode::Char('D') => {
                    if let Some(url) = delete_link(&v.value) {
                        let back = Viewer { title: v.title.clone(), value: v.value.clone(), text_cache: None, reveal: false, scroll: 0, error: false };
                        self.screen = Screen::Confirm { url, back: Box::new(back) };
                    }
                }
                _ => {}
            },
            Screen::Mcp { tools, selected } => match key.code {
                KeyCode::Esc => self.screen = Screen::Menu,
                KeyCode::Up | KeyCode::Char('k') => *selected = selected.saturating_sub(1),
                KeyCode::Down | KeyCode::Char('j') => *selected = (*selected + 1).min(tools.len() - 1),
                KeyCode::Enter => {
                    let tool = tools[*selected].clone();
                    let name = tool.get("name").and_then(Value::as_str).unwrap_or("").to_string();
                    let s = hs(self.lang);
                    let mut f = field("json", s.f_json, "{}", Kind::Multi, false, false);
                    f.area.insert_str("{}");
                    self.screen = Screen::Form(Form { act: Act::Mcp, title: name.clone(), fields: vec![f], focus: 0, error: None, tool: Some(name) });
                }
                _ => {}
            },
            Screen::Confirm { url, back } => match key.code {
                KeyCode::Enter => {
                    let url = url.clone();
                    let title = back.title.clone();
                    self.run_named(title, Act::Delete, vec!["delete".into(), url]);
                }
                KeyCode::Esc => self.screen = Screen::Menu,
                _ => {}
            },
        }
    }

    fn run_named(&mut self, title: String, act: Act, args: Vec<String>) {
        self.screen = Screen::Busy(title.clone());
        let exec = self.exec.clone();
        let tx = self.tx.clone();
        tokio::spawn(async move {
            let outcome = exec(args, None).await;
            let _ = tx.send(Msg::Done { title, outcome, act });
        });
    }
}

fn public_link(value: &Value) -> Option<String> {
    ["fourwords_url", "url"].iter().find_map(|k| value.get(*k).and_then(Value::as_str)).filter(|u| u.starts_with("http")).map(|u| u.to_string())
}

fn delete_link(value: &Value) -> Option<String> {
    ["delete_url", "deleteUrl"].iter().find_map(|k| value.get(*k).and_then(Value::as_str)).map(str::to_string)
}

// ---- rendering -----------------------------------------------------------------------------

fn block<'a>(th: &Theme, title: &str, focused: bool) -> Block<'a> {
    let style = if focused { th.border_focus } else { th.border };
    let bt = if th.unicode { BorderType::Rounded } else { BorderType::Plain };
    Block::bordered().border_type(bt).border_style(style).title(Line::from(vec![Span::raw(" "), Span::styled(title.to_string(), if focused { th.accent } else { th.dim }), Span::raw(" ")]))
}

fn draw(f: &mut Frame, hub: &mut Hub) {
    let area = f.area();
    let th = hub.theme.clone();
    let s = hub.s();
    if area.width < 26 || area.height < 8 {
        f.render_widget(Paragraph::new(Line::styled(s.resize, th.accent)), area);
        return;
    }
    let rows = Layout::vertical([Constraint::Length(2), Constraint::Min(3), Constraint::Length(1)]).split(area);
    let title = format!("F O U R W O R D S   4w {}", fw_core::VERSION);
    f.render_widget(
        Paragraph::new(vec![
            Line::from(vec![Span::styled(title, th.brand)]),
            Line::styled(format!("{}  [{}]", s.tagline, hub.lang.code().to_uppercase()), th.dim),
        ]),
        rows[0],
    );
    match &mut hub.screen {
        Screen::Menu => draw_menu(f, hub, rows[1]),
        Screen::Form(_) => draw_form(f, hub, rows[1]),
        Screen::Busy(title) => {
            let b = block(&th, title, true);
            let inner = b.inner(rows[1]);
            f.render_widget(b, rows[1]);
            f.render_widget(Paragraph::new(Line::styled(format!(" {}", s.busy), th.accent)), inner);
        }
        Screen::Viewer(_) => draw_viewer(f, hub, rows[1]),
        Screen::Mcp { .. } => draw_mcp(f, hub, rows[1]),
        Screen::Confirm { url, .. } => {
            let b = block(&th, s.delete.0, true);
            let inner = b.inner(rows[1]);
            f.render_widget(b, rows[1]);
            let masked = fw_core::sanitize::mask_secrets(url, hub.lang);
            let lines = vec![Line::styled(format!(" {masked}"), th.dim), Line::default(), Line::styled(format!(" {}", s.confirm_delete), th.warn)];
            f.render_widget(Paragraph::new(lines), inner);
        }
    }
    let footer = if let Some((text, until)) = &hub.toast {
        if *until > std::time::Instant::now() { Some(Line::styled(format!(" {text}"), th.ok.add_modifier(Modifier::BOLD))) } else { None }
    } else {
        None
    };
    let hint = match &hub.screen {
        Screen::Menu => s.nav,
        Screen::Form(_) => s.form_nav,
        Screen::Viewer(_) => s.result_nav,
        Screen::Mcp { .. } => "↑↓ Navigate   Enter Call   Esc Back",
        _ => "Esc Back",
    };
    f.render_widget(Paragraph::new(footer.unwrap_or_else(|| Line::styled(format!(" {}", clip_text(hint, area.width as usize - 1, "…")), th.dim))), rows[2]);
}

fn draw_menu(f: &mut Frame, hub: &Hub, area: Rect) {
    let th = &hub.theme;
    let s = hub.s();
    let wide = area.width >= 82;
    let cols = if wide { Layout::horizontal([Constraint::Length(36), Constraint::Min(20)]).split(area) } else { Layout::horizontal([Constraint::Min(10)]).split(area) };
    let b = block(th, s.menu, true);
    let inner = b.inner(cols[0]);
    f.render_widget(b, cols[0]);
    let h = inner.height as usize;
    let skip = hub.sel.saturating_sub(h.saturating_sub(3));
    let mut lines: Vec<Line> = Vec::new();
    for (i, item) in hub.items.iter().enumerate().skip(skip).take(h) {
        match item {
            Item::Section(name) => lines.push(Line::styled(format!(" {name}"), th.brand)),
            Item::Act(act) => {
                let (title, _) = hub.act_info(*act);
                let style = if i == hub.sel { th.selected } else { th.text };
                lines.push(Line::styled(format!(" {} {title} ", if i == hub.sel { "›" } else { " " }), style));
            }
            Item::Recent(entry) => {
                let link = entry.link().unwrap_or("?");
                let short = crate::util::room_slug(link);
                let owner = if entry.admin_key.is_some() || vault::admin_key_for(link).is_some() { format!(" [{}]", s.owner) } else { String::new() };
                let text = format!(" {} ↪ {} · {}{}", if i == hub.sel { "›" } else { " " }, clip_text(&short, 22, "…"), ago(entry.created_at, s), owner);
                lines.push(Line::styled(text, if i == hub.sel { th.selected } else { th.text }));
            }
        }
    }
    f.render_widget(Paragraph::new(lines), inner);
    if wide {
        let b = block(th, s.details, false);
        let inner = b.inner(cols[1]);
        f.render_widget(b, cols[1]);
        let (title, desc, extra) = match hub.items.get(hub.sel) {
            Some(Item::Act(act)) => {
                let (t, d) = hub.act_info(*act);
                (t.to_string(), d.to_string(), String::new())
            }
            Some(Item::Recent(e)) => (crate::util::room_slug(e.link().unwrap_or("")), s.recent_desc.to_string(), e.link().unwrap_or("").to_string()),
            _ => (String::new(), String::new(), String::new()),
        };
        let mut lines = vec![Line::styled(format!(" {title}"), th.accent), Line::default()];
        for row in wrap(&desc, inner.width as usize - 2) {
            lines.push(Line::raw(format!(" {row}")));
        }
        if !extra.is_empty() {
            lines.push(Line::default());
            lines.push(Line::styled(format!(" {extra}"), th.dim));
        }
        f.render_widget(Paragraph::new(lines), inner);
    }
}

fn draw_form(f: &mut Frame, hub: &mut Hub, area: Rect) {
    let th = hub.theme.clone();
    let s = hub.s();
    let Screen::Form(form) = &mut hub.screen else { return };
    let b = block(&th, &form.title, true);
    let inner = b.inner(area);
    f.render_widget(b, area);
    let mut y = inner.y;
    let bottom = inner.y + inner.height;
    let last = form.fields.len();
    let focus = form.focus;
    // first visible field: keep the focused one on screen
    let heights: Vec<u16> = form.fields.iter().map(|f| match f.kind { Kind::Multi => 7, _ => 3 }).collect();
    let mut start = 0usize;
    while start < focus.min(last.saturating_sub(1)) && heights[start..=focus.min(last.saturating_sub(1))].iter().sum::<u16>() + 2 > inner.height {
        start += 1;
    }
    for (i, field) in form.fields.iter_mut().enumerate().skip(start) {
        let h = heights[i];
        if y + h > bottom.saturating_sub(2) {
            break;
        }
        let focused = i == focus;
        let label = format!("{}{}", field.label, if field.required { " *" } else { "" });
        f.render_widget(Paragraph::new(Line::styled(format!(" {label}"), if focused { th.accent } else { th.dim })), Rect { x: inner.x, y, width: inner.width, height: 1 });
        let body = Rect { x: inner.x + 1, y: y + 1, width: inner.width.saturating_sub(2), height: h - 1 };
        match field.kind {
            Kind::Toggle => {
                let text = format!("{} {}", if field.on { "[x]" } else { "[ ]" }, if field.on { "on" } else { "off" });
                f.render_widget(Paragraph::new(Line::styled(text, if focused { th.selected } else { th.text })), Rect { height: 1, ..body });
            }
            Kind::Line => {
                let line = if field.line.text.is_empty() && !focused { Line::styled(field.hint.clone(), th.dim) } else { line_with_cursor(&field.line, &th, focused) };
                f.render_widget(Paragraph::new(line), Rect { height: 1, ..body });
            }
            Kind::Multi => {
                let bb = Block::bordered().border_type(if th.unicode { BorderType::Rounded } else { BorderType::Plain }).border_style(if focused { th.border_focus } else { th.border });
                let ib = bb.inner(body);
                f.render_widget(bb, body);
                field.area.set_cursor_style(if focused { Style::default().add_modifier(Modifier::REVERSED) } else { Style::default() });
                f.render_widget(&field.area, ib);
            }
        }
        y += h;
    }
    let submit_style = if focus == last { th.selected } else { th.accent };
    let by = bottom.saturating_sub(1);
    let status = form.error.clone().map(|e| Line::styled(format!(" {e}"), th.err)).unwrap_or_else(|| Line::styled(format!(" › {} (Ctrl+S)", s.submit), submit_style));
    f.render_widget(Paragraph::new(status), Rect { x: inner.x, y: by, width: inner.width, height: 1 });
    if form.error.is_some() {
        f.render_widget(Paragraph::new(Line::styled(format!(" › {}", s.submit), submit_style)), Rect { x: inner.x, y: by.saturating_sub(1), width: inner.width, height: 1 });
    }
}

fn line_with_cursor(input: &crate::app::LineInput, th: &Theme, focused: bool) -> Line<'static> {
    let chars: Vec<char> = input.text.chars().collect();
    let before: String = chars.iter().take(input.cursor).collect();
    let at: String = chars.get(input.cursor).map(|c| c.to_string()).unwrap_or_else(|| " ".into());
    let after: String = chars.iter().skip(input.cursor + 1).collect();
    let cursor = if focused { Style::default().add_modifier(Modifier::REVERSED) } else { Style::default() };
    Line::from(vec![Span::styled("› ", th.accent), Span::raw(before), Span::styled(at, cursor), Span::raw(after)])
}

fn draw_viewer(f: &mut Frame, hub: &mut Hub, area: Rect) {
    let th = hub.theme.clone();
    let s = hub.s();
    let lang = hub.lang;
    let Screen::Viewer(v) = &mut hub.screen else { return };
    let status = if v.error { s.error } else if v.reveal { s.credentials_visible } else { s.response };
    let b = block(&th, &format!("{status} · {}", v.title), true);
    let inner = b.inner(area);
    f.render_widget(b, area);
    let key = (v.reveal, lang);
    if v.text_cache.as_ref().map(|(r, l, _)| (*r, *l)) != Some(key) {
        let raw = match &v.value {
            Value::String(text) if v.error || v.value.as_str().is_some() => text.clone(),
            other => json_masked(other, v.reveal, lang),
        };
        let clean = text_safe(&if v.error { fw_core::sanitize::mask_secrets(&raw, lang) } else { raw });
        let lines: Vec<String> = clean.split('\n').flat_map(|l| wrap(l, inner.width as usize - 2)).collect();
        v.text_cache = Some((v.reveal, lang, lines));
    }
    let lines = v.text_cache.as_ref().map(|c| c.2.clone()).unwrap_or_default();
    let h = inner.height as usize;
    v.scroll = v.scroll.min(lines.len().saturating_sub(h));
    let mut shown: Vec<Line> = Vec::new();
    if let Some(link) = public_link(&v.value) {
        shown.push(Line::styled(format!(" {}", clean_line(&link)), th.ok));
    }
    let room = h.saturating_sub(shown.len());
    shown.extend(lines.iter().skip(v.scroll).take(room).map(|l| Line::raw(format!(" {l}"))));
    f.render_widget(Paragraph::new(shown), inner);
}

fn draw_mcp(f: &mut Frame, hub: &Hub, area: Rect) {
    let th = &hub.theme;
    let s = hub.s();
    let Screen::Mcp { tools, selected } = &hub.screen else { return };
    let b = block(th, &fmt(s.mcp_tools, &[("n", &tools.len().to_string())]), true);
    let inner = b.inner(area);
    f.render_widget(b, area);
    let h = inner.height as usize;
    let skip = selected.saturating_sub(h.saturating_sub(1));
    let lines: Vec<Line> = tools
        .iter()
        .enumerate()
        .skip(skip)
        .take(h)
        .map(|(i, t)| {
            let name = clean_line(t.get("name").and_then(Value::as_str).unwrap_or("?"));
            let desc = clean_line(t.get("title").or_else(|| t.get("description")).and_then(Value::as_str).unwrap_or(""));
            let text = format!(" {} {name}  {}", if i == *selected { "›" } else { " " }, clip_text(&desc, (inner.width as usize).saturating_sub(name.len() + 8), "…"));
            Line::styled(text, if i == *selected { th.selected } else { th.text })
        })
        .collect();
    f.render_widget(Paragraph::new(lines), inner);
    let _ = Clear;
}

/// Runs the home screen until the user opens a room or quits.
pub async fn run_hub(exec: Exec) -> Result<HubOutcome> {
    let mut term = Term::enter(false)?;
    let (tx, mut rx) = unbounded_channel::<Msg>();
    let mut hub = Hub {
        exec,
        tx,
        theme: Theme::detect(),
        lang: fw_core::lang::resolve(),
        items: Vec::new(),
        sel: 1,
        screen: Screen::Menu,
        toast: None,
        dirty: true,
        quit: None,
        raw_out: Vec::new(),
    };
    hub.rebuild();
    let (key_tx, mut key_rx) = unbounded_channel();
    let stop = Arc::new(AtomicBool::new(false));
    term::spawn_input(key_tx, stop.clone());
    let mut tick = tokio::time::interval(Duration::from_millis(500));
    loop {
        if hub.dirty {
            for raw in hub.raw_out.drain(..) {
                term.write_raw(&raw);
            }
            term.terminal.draw(|frame| draw(frame, &mut hub))?;
            hub.dirty = false;
        }
        tokio::select! {
            Some(ev) = key_rx.recv() => match ev {
                CtEvent::Key(k) if k.kind != KeyEventKind::Release => hub.key(k),
                CtEvent::Paste(text) => {
                    if let Screen::Form(form) = &mut hub.screen {
                        let last = form.fields.len();
                        if form.focus < last {
                            let f = &mut form.fields[form.focus];
                            let clean = fw_core::sanitize::doc_safe(&text);
                            match f.kind {
                                Kind::Multi => { f.area.insert_str(clean); }
                                Kind::Line => f.line.insert_str(clean.trim()),
                                Kind::Toggle => {}
                            }
                        }
                    }
                    hub.dirty = true;
                }
                CtEvent::Resize(..) => hub.dirty = true,
                _ => {}
            },
            Some(msg) = rx.recv() => hub.on_msg(msg),
            _ = tick.tick() => {
                if hub.toast.as_ref().is_some_and(|(_, t)| *t <= std::time::Instant::now()) {
                    hub.toast = None;
                    hub.dirty = true;
                }
            }
        }
        if let Some(outcome) = hub.quit.take() {
            stop.store(true, Ordering::SeqCst);
            return Ok(outcome);
        }
    }
}
