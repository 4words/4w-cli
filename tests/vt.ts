/** Minimal terminal emulator: enough of CSI (cursor moves, erase, SGR) to reconstruct what a
 * Ratatui/crossterm program put on screen. Used by the PTY tests to assert on visible text. */

export class Screen {
  rows: string[][];
  r = 0;
  c = 0;
  private pending = "";
  private rawLog = "";

  constructor(public height = 30, public width = 100) {
    this.rows = Array.from({ length: height }, () => Array(width).fill(" "));
  }

  get raw() { return this.rawLog; }

  feed(chunk: string) {
    this.rawLog += chunk;
    const data = this.pending + chunk;
    this.pending = "";
    let i = 0;
    while (i < data.length) {
      const ch = data[i];
      if (ch === "\x1b") {
        if (i + 1 >= data.length) { this.pending = data.slice(i); return; }
        const next = data[i + 1];
        if (next === "[") {
          let j = i + 2;
          while (j < data.length && !/[\x40-\x7e]/.test(data[j])) j++;
          if (j >= data.length) { this.pending = data.slice(i); return; }
          this.csi(data.slice(i + 2, j), data[j]);
          i = j + 1;
        } else if (next === "]") {
          let j = i + 2;
          while (j < data.length && data[j] !== "\x07" && !(data[j] === "\x1b" && data[j + 1] === "\\")) j++;
          if (j >= data.length) { this.pending = data.slice(i); return; }
          i = data[j] === "\x07" ? j + 1 : j + 2;
        } else { i += 2; }
        continue;
      }
      if (ch === "\r") { this.c = 0; i++; continue; }
      if (ch === "\n") { this.r = Math.min(this.r + 1, this.height - 1); i++; continue; }
      if (ch === "\x07" || ch === "\x08") { i++; continue; }
      const cp = data.codePointAt(i)!;
      const glyph = String.fromCodePoint(cp);
      i += glyph.length;
      const w = Math.max(1, Bun.stringWidth(glyph));
      if (this.r < this.height && this.c < this.width) {
        this.rows[this.r][this.c] = glyph;
        for (let k = 1; k < w && this.c + k < this.width; k++) this.rows[this.r][this.c + k] = "";
      }
      this.c += w;
    }
  }

  private csi(params: string, final: string) {
    const nums = params.replace(/^[?>]/, "").split(";").map((n) => (n === "" ? NaN : Number(n)));
    const n = (k: number, d: number) => (Number.isNaN(nums[k]) || nums[k] === undefined ? d : nums[k]);
    switch (final) {
      case "H": case "f": this.r = Math.min(n(0, 1) - 1, this.height - 1); this.c = Math.min(n(1, 1) - 1, this.width - 1); break;
      case "A": this.r = Math.max(0, this.r - n(0, 1)); break;
      case "B": this.r = Math.min(this.height - 1, this.r + n(0, 1)); break;
      case "C": this.c = Math.min(this.width - 1, this.c + n(0, 1)); break;
      case "D": this.c = Math.max(0, this.c - n(0, 1)); break;
      case "G": this.c = n(0, 1) - 1; break;
      case "J": {
        const mode = n(0, 0);
        if (mode === 2 || mode === 3) this.rows = Array.from({ length: this.height }, () => Array(this.width).fill(" "));
        else if (mode === 0) { for (let x = this.c; x < this.width; x++) this.rows[this.r][x] = " "; for (let y = this.r + 1; y < this.height; y++) this.rows[y].fill(" "); }
        break;
      }
      case "K": {
        const mode = n(0, 0);
        const from = mode === 1 ? 0 : this.c;
        const to = mode === 0 ? this.width : mode === 1 ? this.c + 1 : this.width;
        for (let x = from; x < to; x++) this.rows[this.r][x] = " ";
        break;
      }
      default: break; // SGR (m), modes (h/l), etc. do not change the text
    }
  }

  /** Visible text, right-trimmed per row. */
  lines(): string[] { return this.rows.map((row) => row.join("").replace(/\s+$/, "")); }
  text(): string { return this.lines().join("\n"); }
  contains(s: string): boolean { return this.text().includes(s); }
}
