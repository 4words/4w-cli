import { textSafe } from "./tui-model";

export const segmenter = new Intl.Segmenter("pt-BR", { granularity: "grapheme" });

function fallbackWidth(value: string): number {
  const plain = value.replace(/\x1b\[[\d;]*m/g, "");
  let cells = 0;
  for (const { segment } of segmenter.segment(plain)) {
    const code = segment.codePointAt(0) ?? 0;
    const wide =
      code >= 0x1100 &&
      (code <= 0x115f ||
        code === 0x2329 ||
        code === 0x232a ||
        (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
        (code >= 0xac00 && code <= 0xd7a3) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0xfe10 && code <= 0xfe19) ||
        (code >= 0xfe30 && code <= 0xfe6f) ||
        (code >= 0xff00 && code <= 0xff60) ||
        (code >= 0xffe0 && code <= 0xffe6) ||
        code >= 0x1f000);
    cells += wide ? 2 : 1;
  }
  return cells;
}

export function width(value: string) {
  if (typeof Bun !== "undefined" && typeof Bun.stringWidth === "function") {
    return Bun.stringWidth(value);
  }
  return fallbackWidth(value);
}

export function clip(value: string, size: number) {
  if (size <= 0) return "";
  if (width(value) <= size) return value;
  let line = "";
  let cells = 0;
  for (const { segment } of segmenter.segment(value)) {
    const next = width(segment);
    if (cells + next > size) break;
    line += segment;
    cells += next;
  }
  return line;
}

export function pad(value: string, size: number) {
  return value + " ".repeat(Math.max(0, size - width(value)));
}

export function wrap(value: string, size: number): string[] {
  if (size < 2) return [""];
  return textSafe(value).split("\n").flatMap((logical) => {
    if (width(logical) <= size) return [logical];
    const lines: string[] = [];
    let line = "";
    let cells = 0;
    let breakAt = -1;
    for (const { segment } of segmenter.segment(logical)) {
      const next = width(segment);
      if (cells + next > size) {
        if (breakAt > line.length / 2) {
          lines.push(line.slice(0, breakAt));
          line = line.slice(breakAt + 1);
          cells = width(line);
        } else {
          lines.push(line);
          line = "";
          cells = 0;
        }
        breakAt = line.lastIndexOf(" ");
      }
      if (segment === " ") breakAt = line.length;
      line += segment;
      cells += next;
    }
    return [...lines, line];
  });
}

const enableColor = process.env.NO_COLOR === undefined;
const palette = {
  brand: "1;95", accent: "1;96", selected: "1;97;45", bright: "1;97", dim: "90", success: "1;92", error: "1;91",
  cursor: "7",
} as const;

export function paint(value: string, tone: keyof typeof palette) {
  if (!enableColor && tone !== "cursor") return value;
  return `\x1b[${palette[tone]}m${value}\x1b[0m`;
}

export function cleanLine(value: string) {
  return textSafe(value).replace(/\n/g, " ");
}

export function line(value: string, size: number, tone?: keyof typeof palette) {
  const output = clip(cleanLine(value), size);
  return tone ? paint(output, tone) : output;
}

export function fieldLine(before: string, after: string, size: number) {
  // Keep the caret visible when a path or JSON line is wider than the screen.
  let left = before;
  if (width(left) >= size) {
    left = "";
    let cells = 0;
    const parts = [...segmenter.segment(before)];
    for (let i = parts.length - 1; i >= 0; i--) {
      const segment = parts[i].segment;
      cells += width(segment);
      if (cells >= size - 1) break;
      left = segment + left;
    }
    left = "‹" + left;
  }
  const available = Math.max(1, size - width(left));
  const current = segmenter.segment(after)[Symbol.iterator]().next().value?.segment ?? " ";
  const cursor = width(current) <= available ? current : " ";
  return left + paint(cursor, "cursor") + clip(after.slice(current.length), available - width(cursor));
}
