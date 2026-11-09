import { emitKeypressEvents } from "node:readline";
import type { Tool } from "./commands";
import { help, normalizeLang, resolveLang, saveLang, VERSION, type Lang } from "./help";
import { actionsFor, deleteLink, keyGuideFor, maskSecrets, object, publicLink, resultJson, type Action, type Field, type Job, type Values } from "./tui-model";
import { cleanLine, fieldLine, line, pad, paint, segmenter, width, wrap } from "./tui-screen";

type Execute = (args: string[], signal?: AbortSignal, input?: string) => Promise<unknown>;
type Key = { name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean; sequence?: string };
type Home = { kind: "home"; index: number };
type Catalog = { kind: "catalog"; tools: Tool[]; index: number; back: Home };
type Form = {
  kind: "form"; action: Action; fields: Field[]; values: Values; cursors: Record<string, number>;
  focus: number; back: Home | Catalog; tool?: Tool; issue?: string;
};
type Confirm = { kind: "confirm"; form: Form };
type Busy = { kind: "busy"; title: string; back: Form | Home; controller: AbortController };
type Viewer = {
  kind: "viewer"; title: string; back: Form | Home | Catalog; offset: number; reveal: boolean;
  status: "guide" | "success" | "error"; text?: string; value?: unknown; link?: string;
  deleteUrl?: string;
  edit?: { room: string; revision: number; content: string }; room?: string;
  cache?: { size: number; reveal: boolean; lines: string[] };
};
type Screen = Home | Catalog | Form | Confirm | Busy | Viewer;

type UiStrings = {
  subtitle: string;
  navigation: string;
  navCompactTiny: string;
  navCompactMid: string;
  enterToOpen: string;
  fillField: (label: string) => string;
  mcpToolDefault: string;
  jsonArgsLabel: string;
  jsonArgsHint: string;
  waitCancelled: string;
  cmdHelpTitle: string;
  maxCharsError: string;
  panelGuideTitle: string;
  mcpExplorerTitle: string;
  mcpCatalogHeader: (count: number) => string;
  catalogFooter: string;
  clipboardNotice: string;
  toggleOn: string;
  toggleOff: string;
  continueBtn: string;
  resizeWindow: string;
  formFooterWide: string;
  formFooterCompact: string;
  confirmHeader: string;
  confirmBody: string;
  confirmFooter: string;
  busyHeader: string;
  busyBody: string;
  busyFooter: string;
  statusSuccessRevealed: string;
  statusSuccess: string;
  statusError: string;
  statusHelp: string;
  revisionPrefix: string;
  btnCopy: string;
  btnEdit: string;
  btnDestroy: string;
  btnCredentials: string;
  btnBack: string;
  btnScroll: string;
  langSavedNotice: (code: Lang) => string;
};

const uiByLang: Record<Lang, UiStrings> = {
  en: {
    subtitle: "Sharing  /  Rooms  /  MCP",
    navigation: "↑↓ Navigate   Enter Open   L Lang   ? Help   Esc Quit",
    navCompactTiny: "↑↓  Enter  ? Help  Esc",
    navCompactMid: "↑↓ Menu  Enter Open  ? Help  Esc",
    enterToOpen: "Press Enter to open",
    fillField: (label) => `Please fill in the ${label} field.`,
    mcpToolDefault: "Tool advertised by MCP.",
    jsonArgsLabel: "JSON Arguments",
    jsonArgsHint: "F1 shows description and input schema.",
    waitCancelled: "Wait cancelled. A request already received by the server may still apply.",
    cmdHelpTitle: "Command help",
    maxCharsError: "The editor accepts up to 200,000 characters in this field.",
    panelGuideTitle: "Panel guide",
    mcpExplorerTitle: "MCP Explorer",
    mcpCatalogHeader: (n) => `MCP Explorer · ${n} tools`,
    catalogFooter: "↑↓ Navigate   Enter Open   F1 Help   Esc Back",
    clipboardNotice: "Link sent to clipboard. Your terminal may block OSC 52 copy.",
    toggleOn: "  ◉ Enabled",
    toggleOff: "  ○ Disabled",
    continueBtn: "Continue",
    resizeWindow: "4w · Enlarge terminal window",
    formFooterWide: "Tab Fields   F2 / Ctrl+S Continue   F1 Help   Esc Back",
    formFooterCompact: "Tab Fields  Ctrl+S Submit  Esc Back",
    confirmHeader: "CONFIRM OPERATION",
    confirmBody: "Form data will be sent to the configured MCP endpoint.",
    confirmFooter: "Enter Confirm   Esc Review",
    busyHeader: "CONNECTING TO FOURWORDS",
    busyBody: "Waiting for MCP response…",
    busyFooter: "Esc Cancel wait   Ctrl+C Quit",
    statusSuccessRevealed: "RESPONSE · CREDENTIALS VISIBLE",
    statusSuccess: "RESPONSE",
    statusError: "ERROR",
    statusHelp: "HELP",
    revisionPrefix: "Revision",
    btnCopy: "Y Copy",
    btnEdit: "E Edit",
    btnDestroy: "D Destroy",
    btnCredentials: "V Credentials",
    btnBack: "Esc Back",
    btnScroll: "↑↓ Scroll",
    langSavedNotice: (code) => `Language saved on this machine: ${code.toUpperCase()}`,
  },
  ptbr: {
    subtitle: "Compartilhamento  /  Salas  /  MCP",
    navigation: "↑↓ Navegar   Enter Abrir   L Idioma   ? Ajuda   Esc Sair",
    navCompactTiny: "↑↓  Enter  ? Ajuda  Esc",
    navCompactMid: "↑↓ Menu  Enter Abrir  ? Ajuda  Esc",
    enterToOpen: "Enter para abrir",
    fillField: (label) => `Preencha o campo ${label}.`,
    mcpToolDefault: "Ferramenta anunciada pelo MCP.",
    jsonArgsLabel: "Argumentos JSON",
    jsonArgsHint: "F1 mostra a descrição e o esquema.",
    waitCancelled: "Espera cancelada. Uma solicitação já recebida pelo servidor pode ter sido aplicada.",
    cmdHelpTitle: "Ajuda do comando",
    maxCharsError: "O editor aceita até 200.000 caracteres neste campo.",
    panelGuideTitle: "Guia do painel",
    mcpExplorerTitle: "Explorador MCP",
    mcpCatalogHeader: (n) => `Explorador MCP · ${n} ferramentas`,
    catalogFooter: "↑↓ Navegar   Enter Abrir   F1 Ajuda   Esc Voltar",
    clipboardNotice: "Link enviado à área de transferência. O terminal pode bloquear a cópia.",
    toggleOn: "  ◉ Ativada",
    toggleOff: "  ○ Desativada",
    continueBtn: "Continuar",
    resizeWindow: "4w · Amplie a janela",
    formFooterWide: "Tab Campos   F2 / Ctrl+S Continuar   F1 Ajuda   Esc Voltar",
    formFooterCompact: "Tab Campos  Ctrl+S Enviar  Esc Voltar",
    confirmHeader: "CONFIRMAR OPERAÇÃO",
    confirmBody: "Os dados do formulário serão enviados ao endpoint MCP configurado.",
    confirmFooter: "Enter Confirmar   Esc Revisar",
    busyHeader: "CONECTANDO AO FOURWORDS",
    busyBody: "Aguardando a resposta do MCP…",
    busyFooter: "Esc Cancelar espera   Ctrl+C Sair",
    statusSuccessRevealed: "RESPOSTA · CREDENCIAIS VISÍVEIS",
    statusSuccess: "RESPOSTA",
    statusError: "ERRO",
    statusHelp: "AJUDA",
    revisionPrefix: "Revisão",
    btnCopy: "Y Copiar",
    btnEdit: "E Editar",
    btnDestroy: "D Destruir",
    btnCredentials: "V Credenciais",
    btnBack: "Esc Voltar",
    btnScroll: "↑↓ Rolar",
    langSavedNotice: (code) => `Idioma salvo nesta máquina: ${code.toUpperCase()}`,
  },
  es: {
    subtitle: "Compartir  /  Salas  /  MCP",
    navigation: "↑↓ Navegar   Enter Abrir   L Idioma   ? Ayuda   Esc Salir",
    navCompactTiny: "↑↓  Enter  ? Ayuda  Esc",
    navCompactMid: "↑↓ Menú  Enter Abrir  ? Ayuda  Esc",
    enterToOpen: "Enter para abrir",
    fillField: (label) => `Complete el campo ${label}.`,
    mcpToolDefault: "Herramienta anunciada por el MCP.",
    jsonArgsLabel: "Argumentos JSON",
    jsonArgsHint: "F1 muestra la descripción y el esquema.",
    waitCancelled: "Espera cancelada. Una solicitud ya recibida por el servidor puede haberse aplicado.",
    cmdHelpTitle: "Ayuda del comando",
    maxCharsError: "El editor acepta hasta 200.000 caracteres en este campo.",
    panelGuideTitle: "Guía del panel",
    mcpExplorerTitle: "Explorador MCP",
    mcpCatalogHeader: (n) => `Explorador MCP · ${n} herramientas`,
    catalogFooter: "↑↓ Navegar   Enter Abrir   F1 Ayuda   Esc Volver",
    clipboardNotice: "Enlace enviado al portapapeles. La terminal puede bloquear la copia.",
    toggleOn: "  ◉ Activada",
    toggleOff: "  ○ Desactivada",
    continueBtn: "Continuar",
    resizeWindow: "4w · Amplíe la ventana",
    formFooterWide: "Tab Campos   F2 / Ctrl+S Continuar   F1 Ayuda   Esc Volver",
    formFooterCompact: "Tab Campos  Ctrl+S Enviar  Esc Volver",
    confirmHeader: "CONFIRMAR OPERACIÓN",
    confirmBody: "Los datos del formulario se enviarán al endpoint MCP configurado.",
    confirmFooter: "Enter Confirmar   Esc Revisar",
    busyHeader: "CONECTANDO A FOURWORDS",
    busyBody: "Esperando respuesta del MCP…",
    busyFooter: "Esc Cancelar espera   Ctrl+C Salir",
    statusSuccessRevealed: "RESPUESTA · CREDENCIALES VISIBLES",
    statusSuccess: "RESPUESTA",
    statusError: "ERROR",
    statusHelp: "AYUDA",
    revisionPrefix: "Revisión",
    btnCopy: "Y Copiar",
    btnEdit: "E Editar",
    btnDestroy: "D Destruir",
    btnCredentials: "V Credenciales",
    btnBack: "Esc Volver",
    btnScroll: "↑↓ Desplazar",
    langSavedNotice: (code) => `Idioma guardado en esta máquina: ${code.toUpperCase()}`,
  },
};

function viewer(title: string, back: Viewer["back"], status: Viewer["status"], text?: string): Viewer {
  return { kind: "viewer", title, back, status, text, reveal: false, offset: 0 };
}

function lastLineStart(value: string, cursor: number) {
  return cursor <= 0 ? 0 : value.lastIndexOf("\n", cursor - 1) + 1;
}

function nextLineEnd(value: string, cursor: number) {
  const end = value.indexOf("\n", cursor);
  return end < 0 ? value.length : end;
}

function editField(value: string, cursor: number, key: Key, inserted = ""): [string, number] {
  if (inserted) return [value.slice(0, cursor) + inserted + value.slice(cursor), cursor + inserted.length];
  const start = lastLineStart(value, cursor);
  const end = nextLineEnd(value, cursor);
  const segments = segmenter.segment(value);
  const left = cursor > 0 ? segments.containing(cursor - 1)?.index ?? cursor - 1 : 0;
  const right = segments.containing(cursor)?.segment.length ?? 0;
  switch (key.name) {
    case "left": return [value, left];
    case "right": return [value, cursor + right];
    case "home": return [value, start];
    case "end": return [value, end];
    case "up": {
      if (!start) return [value, cursor];
      const previous = lastLineStart(value, start - 1);
      const next = Math.min(previous + cursor - start, start - 1);
      return [value, segments.containing(next)?.index ?? next];
    }
    case "down": {
      if (end === value.length) return [value, cursor];
      const next = Math.min(end + 1 + cursor - start, nextLineEnd(value, end + 1));
      return [value, segments.containing(next)?.index ?? next];
    }
    case "backspace": return [value.slice(0, left) + value.slice(cursor), left];
    case "delete": return [value.slice(0, cursor) + value.slice(cursor + right), cursor];
    default: return [value, cursor];
  }
}

const appTitle = "F O U R W O R D S";
const langOrder: readonly Lang[] = ["en", "ptbr", "es"];

class Tui {
  private screen: Screen = { kind: "home", index: 0 };
  private lang: Lang = resolveLang();
  private lastRoom = "";
  private lastLlmKey = "";
  private lastAdminKey = "";
  private notice = "";
  private paste = false;
  private scheduled?: ReturnType<typeof setImmediate>;
  private renderedScroll = 0;
  private closed = false;

  constructor(private readonly execute: Execute, private readonly done: (error?: Error) => void) {}

  private ui(): UiStrings {
    return uiByLang[this.lang];
  }

  private currentActions(): Action[] {
    return actionsFor(this.lang);
  }

  private cycleLang() {
    const nextIndex = (langOrder.indexOf(this.lang) + 1) % langOrder.length;
    this.lang = langOrder[nextIndex];
    try { saveLang(this.lang); } catch { /* Ignore read-only disk. */ }
    this.notice = this.ui().langSavedNotice(this.lang);
    this.redraw();
  }

  private change(screen: Screen) {
    this.screen = screen;
    this.notice = "";
    this.redraw();
  }

  private form(action: Action, back: Form["back"], defaults: Values = {}, tool?: Tool): Form {
    const fields = action.fields ?? [];
    const values = Object.fromEntries(fields.map((f) => {
      const sessionDefault = f.id === "room"
        ? this.lastRoom
        : f.id === "llm_key"
          ? this.lastLlmKey
          : f.id === "admin_key"
            ? this.lastAdminKey
            : undefined;
      return [
        f.id,
        defaults[f.id] ?? sessionDefault ?? f.initial ?? (f.mode === "toggle" ? "off" : ""),
      ];
    }));
    return {
      kind: "form", action, fields, values, focus: 0, back, tool,
      cursors: Object.fromEntries(fields.map((f) => [f.id, values[f.id].length])),
    };
  }

  private start(title: string, job: Job, back: Form | Home) {
    const state: Busy = { kind: "busy", title, back, controller: new AbortController() };
    this.change(state);
    this.execute(job.args, state.controller.signal, job.input).then((value) => {
      if (this.closed || this.screen !== state) return;
      if (job.args.join(" ") === "mcp list" && back.kind === "home" && Array.isArray(value)) {
        const tools = (value as Tool[]).filter((tool) => typeof tool?.name === "string");
        if (tools.length) return this.change({ kind: "catalog", tools, index: 0, back });
      }
      const result = viewer(title, back, "success");
      result.value = value;
      const id = back.kind === "form" ? back.action.id : undefined;
      const data = object(value);
      if (job.args[0] === "lang" && typeof data?.lang === "string") {
        const updatedLang = normalizeLang(data.lang);
        if (updatedLang) this.lang = updatedLang;
      }
      result.link = publicLink(value, id?.startsWith("room ") ?? false);
      result.deleteUrl = deleteLink(value);
      result.room = back.kind === "form" ? back.values.room : undefined;
      if (id === "room create" && result.link) result.room = result.link;
      if (result.room) this.lastRoom = result.room;
      if (typeof data?.llm_key === "string") this.lastLlmKey = data.llm_key;
      if (typeof data?.admin_key === "string") this.lastAdminKey = data.admin_key;
      if (id === "room doc" && result.room && typeof data?.content === "string" &&
          typeof data.updated_at === "number" && Number.isSafeInteger(data.updated_at)) {
        result.edit = { room: result.room, revision: data.updated_at, content: data.content };
      }
      this.change(result);
    }).catch((error: unknown) => {
      if (this.closed || this.screen !== state) return;
      const message = error instanceof Error ? error.message : String(error);
      this.change(viewer(title, back, "error", maskSecrets(message, this.lang)));
    });
  }

  private advance(form: Form) {
    const missing = form.fields.findIndex((field) => field.required && !form.values[field.id].trim());
    if (missing >= 0) {
      form.focus = missing;
      form.issue = this.ui().fillField(form.fields[missing].label);
      return this.redraw();
    }
    if (form.action.write) return this.change({ kind: "confirm", form });
    this.start(form.action.title, form.action.job(form.values), form);
  }

  private toolForm(catalog: Catalog) {
    const tool = catalog.tools[catalog.index];
    const ui = this.ui();
    const action: Action = {
      id: "mcp call", section: "MCP", title: tool.name, description: tool.title ?? ui.mcpToolDefault,
      fields: [{ id: "json", label: ui.jsonArgsLabel, mode: "multiline", initial: "{}", hint: ui.jsonArgsHint }],
      write: true, job: (v) => ({ args: ["mcp", "call", tool.name, "-"], input: v.json || "{}" }),
    };
    return this.form(action, catalog, {}, tool);
  }

  private leave() {
    const screen = this.screen;
    if (screen.kind === "home") return this.done();
    if (screen.kind === "busy") {
      screen.controller.abort();
      this.change(screen.back);
      this.notice = this.ui().waitCancelled;
      return this.redraw();
    }
    return this.change(screen.kind === "confirm" ? screen.form : screen.back);
  }

  private inputForm(form: Form, text: string, key: Key) {
    const ui = this.ui();
    if (!this.paste && key.name === "f1") {
      const description = form.tool ? [form.tool.description ?? "", "", resultJson(form.tool.inputSchema ?? {}, false, this.lang)].join("\n") : help(form.action.id, this.lang);
      return this.change(viewer(ui.cmdHelpTitle, form, "guide", description));
    }
    if (!this.paste && (key.name === "f2" || (key.ctrl && key.name === "s"))) return this.advance(form);
    if (!this.paste && key.name === "tab") {
      const length = form.fields.length + 1;
      form.focus = (form.focus + (key.shift ? length - 1 : 1)) % length;
      return this.redraw();
    }
    const field = form.fields[form.focus];
    if (!field) {
      if (!this.paste && key.name === "return") return this.advance(form);
      return;
    }
    if (field.mode === "toggle") {
      if (!this.paste && key.name === "space") {
        form.values[field.id] = form.values[field.id] === "on" ? "off" : "on";
      } else if (!this.paste && key.name === "return") form.focus++;
      return this.redraw();
    }

    const value = form.values[field.id];
    let inserted = "";
    if (key.name === "return" || key.name === "enter") {
      if (field.mode === "multiline") inserted = "\n";
      else if (this.paste) inserted = " ";
      else { form.focus++; return this.redraw(); }
    } else if (this.paste && key.name === "tab") {
      inserted = "  ";
    } else if (text && !key.ctrl && !key.meta) {
      inserted = text.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, "");
      if (field.mode !== "multiline") inserted = inserted.replace(/\n/g, " ");
    }
    if (inserted.length + value.length <= 200_000) {
      const [next, cursor] = editField(value, form.cursors[field.id], this.paste ? {} : key, inserted);
      form.values[field.id] = next;
      form.cursors[field.id] = cursor;
      if (next !== value) form.issue = undefined;
    } else form.issue = ui.maxCharsError;
    this.redraw();
  }

  onKey = (text = "", key: Key = {}) => {
    if (this.closed) return;
    if (key.name === "paste-start" || key.sequence === "\x1b[200~") { this.paste = true; return; }
    if (key.name === "paste-end" || key.sequence === "\x1b[201~") { this.paste = false; return; }
    if (!this.paste && key.ctrl && key.name === "c") return this.done();
    if (!this.paste && key.name === "escape") return this.leave();
    const screen = this.screen;
    if (screen.kind === "form") return this.inputForm(screen, text, key);
    if (this.paste) return;
    const ui = this.ui();
    const list = this.currentActions();
    const direction = key.name === "up" || text === "k" ? -1 : key.name === "down" || text === "j" ? 1 : 0;
    if (screen.kind === "home") {
      if (text === "q") return this.done();
      if (text.toLowerCase() === "l") return this.cycleLang();
      if (text === "?" || key.name === "f1") return this.change(viewer(ui.panelGuideTitle, screen, "guide", keyGuideFor(this.lang)));
      if (direction) screen.index = (screen.index + direction + list.length) % list.length;
      if (key.name === "return") {
        const action = list[screen.index];
        if (action.fields) return this.change(this.form(action, screen));
        return this.start(action.title, action.job({}), screen);
      }
    } else if (screen.kind === "catalog") {
      if (direction) screen.index = (screen.index + direction + screen.tools.length) % screen.tools.length;
      if (key.name === "return") return this.change(this.toolForm(screen));
      if (text === "?" || key.name === "f1") return this.change(viewer(ui.mcpExplorerTitle, screen, "guide", help("mcp call", this.lang)));
    } else if (screen.kind === "confirm") {
      if (key.name === "return") return this.start(screen.form.action.title, screen.form.action.job(screen.form.values), screen.form);
    } else if (screen.kind === "viewer") {
      if (direction) screen.offset += direction;
      if (key.name === "pageup" || key.name === "pagedown") {
        screen.offset += (key.name === "pageup" ? -1 : 1) * Math.max(1, (process.stdout.rows ?? 24) - 8);
      }
      if (key.name === "home") screen.offset = 0;
      if (key.name === "end") screen.offset = this.renderedScroll;
      if (text.toLowerCase() === "v" && screen.status === "success") {
        screen.reveal = !screen.reveal;
        screen.offset = 0;
      }
      if (text.toLowerCase() === "e" && screen.edit) {
        const action = list.find((item) => item.id === "room save")!;
        const home = screen.back.kind === "form" ? screen.back.back : screen.back;
        const form = this.form(action, home, {
          room: screen.edit.room, base: String(screen.edit.revision), markdown: screen.edit.content,
        });
        form.focus = 2;
        return this.change(form);
      }
      if (text.toLowerCase() === "d" && screen.deleteUrl) {
        const action = list.find((item) => item.id === "delete")!;
        const home = screen.back.kind === "form" ? screen.back.back : screen.back;
        const form = this.form(action, home, { delete_url: screen.deleteUrl });
        return this.change({ kind: "confirm", form });
      }
      if (text.toLowerCase() === "y" && screen.link) {
        process.stdout.write(`\x1b]52;c;${Buffer.from(screen.link).toString("base64")}\x07`);
        this.notice = ui.clipboardNotice;
      }
    }
    this.redraw();
  };

  redraw = () => {
    if (this.closed || this.scheduled) return;
    this.scheduled = setImmediate(() => {
      this.scheduled = undefined;
      if (this.closed) return;
      try { this.render(); } catch (error) { this.done(error as Error); }
    });
  };

  stop() {
    this.closed = true;
    if (this.scheduled) clearImmediate(this.scheduled);
    if (this.screen.kind === "busy") this.screen.controller.abort();
  }

  private menu(items: string[], selected: number, size: number, height: number) {
    const start = Math.max(0, Math.min(selected - Math.floor(height / 2), items.length - height));
    return items.slice(start, start + height).map((item, i) => {
      const active = i + start === selected;
      return line((active ? "› " : "  ") + item, size, active ? "selected" : undefined);
    });
  }

  private renderForm(form: Form, size: number, height: number) {
    const ui = this.ui();
    const title = line(form.action.title, size, "accent");
    const available = Math.max(1, height - (form.issue ? 2 : 1));
    const fields = form.fields.flatMap((field, index) => {
      const active = form.focus === index;
      const value = form.values[field.id];
      const label = line((active ? "› " : "  ") + field.label + (field.required ? " *" : ""), size, active ? "accent" : "bright");
      if (field.mode === "toggle") return [[label, line(value === "on" ? ui.toggleOn : ui.toggleOff, size, active ? "accent" : "dim")]];
      const cursor = form.cursors[field.id];
      const start = lastLineStart(value, cursor);
      const end = nextLineEnd(value, cursor);
      const preceding = value.slice(0, start).split("\n").slice(0, -1).slice(-2);
      const following = end === value.length ? [] : value.slice(end + 1).split("\n").slice(0, 1);
      const entries = active ? [
        ...preceding.map((text) => line("  " + text, size, "dim")),
        "  " + fieldLine(cleanLine(value.slice(start, cursor)), cleanLine(value.slice(cursor, end)), size - 2),
        ...following.map((text) => line("  " + text, size, "dim")),
      ] : [line("  " + (value.split("\n")[0] || field.hint || "—"), size, "dim")];
      return [[label, ...entries]];
    });
    fields.push([line((form.focus === form.fields.length ? "› " : "  ") + ui.continueBtn, size,
      form.focus === form.fields.length ? "selected" : "dim")]);
    let start = 0;
    while (start < form.focus && fields.slice(start, form.focus + 1).flat().length > available) start++;
    const visible = fields.slice(start).flat().slice(0, available);
    return [title, ...visible, ...(form.issue ? [line(form.issue, size, "error")] : [])];
  }

  private render() {
    const ui = this.ui();
    const list = this.currentActions();
    const columns = Math.max(2, process.stdout.columns || 80);
    const rows = Math.max(2, process.stdout.rows || 24);
    const size = columns - 1;
    const screen = this.screen;
    if (columns < 26 || rows < 8) {
      process.stdout.write("\x1b[H\x1b[2K" + line(ui.resizeWindow, size, "accent") + "\x1b[J");
      return;
    }
    const header = [
      line(appTitle, size, "brand"),
      line(`4w ${VERSION}  ·  ${ui.subtitle}  ·  [${this.lang.toUpperCase()}]`, size, "dim"),
      line("─".repeat(size), size, "dim"),
    ];
    const height = rows - header.length - 3;
    let body: string[] = [];
    let footer = ui.navigation;
    if (screen.kind === "home") {
      const action = list[screen.index];
      const wide = size >= 82;
      const labels = list.map((entry) => entry.title);
      if (wide) {
        const menuSize = 30;
        const detailsSize = size - menuSize - 4;
        const menu = this.menu(labels, screen.index, menuSize, height);
        const details = [
          line(action.section, detailsSize, "brand"), "", line(action.title, detailsSize, "accent"), "",
          ...wrap(action.description, detailsSize), "", line(ui.enterToOpen, detailsSize, "dim"),
        ];
        body = Array.from({ length: Math.min(height, Math.max(menu.length, details.length)) }, (_, row) => {
          const label = menu[row] ?? "";
          const plain = label.replace(/\x1b\[[\d;]+m/g, "");
          return label + pad("", Math.max(0, menuSize - width(plain))) + paint(" │  ", "dim") + (details[row] ?? "");
        });
      } else {
        body = [line(action.section, size, "brand"), ...this.menu(labels, screen.index, size, Math.max(1, height - 1))];
        footer = size < 34 ? ui.navCompactTiny : ui.navCompactMid;
      }
    } else if (screen.kind === "catalog") {
      body = [line(ui.mcpCatalogHeader(screen.tools.length), size, "accent"),
        ...this.menu(screen.tools.map((tool) => tool.name), screen.index, size, Math.max(1, height - 1))];
      footer = ui.catalogFooter;
    } else if (screen.kind === "form") {
      body = this.renderForm(screen, size, height);
      footer = size >= 62 ? ui.formFooterWide : ui.formFooterCompact;
    } else if (screen.kind === "confirm") {
      body = [line(ui.confirmHeader, size, "brand"), "", line(screen.form.action.title, size, "bright"), "",
        ...wrap(ui.confirmBody, size)];
      footer = ui.confirmFooter;
    } else if (screen.kind === "busy") {
      body = [line(ui.busyHeader, size, "brand"), "", line(screen.title, size, "accent"),
        ...wrap(ui.busyBody, size)];
      footer = ui.busyFooter;
    } else {
      const status = screen.status === "success" ? (screen.reveal ? ui.statusSuccessRevealed : ui.statusSuccess) :
        screen.status === "error" ? ui.statusError : ui.statusHelp;
      body = [line(status, size, screen.status === "error" ? "error" : "brand"), line(screen.title, size, "accent")];
      if (screen.link && height > 4) body.push(line(screen.link, size, "success"));
      if (screen.cache?.size !== size || screen.cache.reveal !== screen.reveal) {
        const markdown = screen.edit && (screen.reveal ? screen.edit.content : maskSecrets(screen.edit.content, this.lang));
        const raw = screen.edit ? `${ui.revisionPrefix} ${screen.edit.revision}\n\n${markdown}` :
          screen.text ?? resultJson(screen.value, screen.reveal, this.lang);
        screen.cache = { size, reveal: screen.reveal, lines: wrap(raw, size) };
      }
      const wrapped = screen.cache.lines;
      const page = Math.max(1, height - body.length);
      this.renderedScroll = Math.max(0, wrapped.length - page);
      screen.offset = Math.max(0, Math.min(screen.offset, this.renderedScroll));
      body.push(...wrapped.slice(screen.offset, screen.offset + page));
      const extra = [
        screen.link ? ui.btnCopy : "",
        screen.edit ? ui.btnEdit : "",
        screen.deleteUrl ? ui.btnDestroy : "",
        screen.status === "success" ? ui.btnCredentials : "",
      ].filter(Boolean);
      footer = [ui.btnBack, ui.btnScroll, ...extra].join("   ");
    }
    const status = this.notice ? line(this.notice, size, "accent") : line("─".repeat(size), size, "dim");
    const visible = body.slice(0, height);
    const frame = [...header, ...visible, ...Array<string>(height - visible.length).fill(""), status, line(footer, size, "dim")];
    process.stdout.write("\x1b[H" + frame.map((row) => "\x1b[2K" + row).join("\r\n") + "\x1b[J");
  }
}

export function openTui(execute: Execute): Promise<void> {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    const wasRaw = stdin.isRaw;
    let closed = false;
    const cleanup = (error?: Error) => {
      if (closed) return;
      closed = true;
      app.stop();
      stdin.off("keypress", onKey);
      stdin.off("end", onEnd);
      stdin.off("error", onError);
      stdout.off("resize", app.redraw);
      process.off("SIGINT", onEnd);
      process.off("SIGTERM", onEnd);
      process.off("SIGHUP", onEnd);
      process.off("exit", restore);
      try { restore(); } catch (cause) { error ??= cause as Error; }
      stdin.pause();
      if (error) reject(error);
      else resolve();
    };
    const app = new Tui(execute, cleanup);
    const restore = () => {
      try { stdin.setRawMode(wasRaw); } finally { stdout.write("\x1b[?2004l\x1b[0m\x1b[?25h\x1b[?1049l"); }
    };
    const onEnd = () => cleanup();
    const onError = (error: Error) => cleanup(error);
    const onKey = (text: string, key: Key) => {
      try { app.onKey(text, key); } catch (error) { cleanup(error as Error); }
    };
    try {
      emitKeypressEvents(stdin);
      stdin.setRawMode(true);
      stdin.on("keypress", onKey);
      stdin.once("end", onEnd);
      stdin.once("error", onError);
      stdout.on("resize", app.redraw);
      process.once("SIGINT", onEnd);
      process.once("SIGTERM", onEnd);
      process.once("SIGHUP", onEnd);
      process.once("exit", restore);
      stdout.write("\x1b[?1049h\x1b[?25l\x1b[?2004h\x1b[2J");
      stdin.resume();
      app.redraw();
    } catch (error) {
      cleanup(error as Error);
    }
  });
}
