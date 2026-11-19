// Models freely emit \( \) and \[ \] math delimiters; remark-math only
// parses $-style. Normalize outside code fences/spans so formulas render
// everywhere (cards, panel, rail, reader) instead of leaking raw.
export function normalizeMath(src: string): string {
  if (!src || (!src.includes('\\(') && !src.includes('\\['))) return src;
  const parts = src.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  return parts
    .map((seg, i) => (i % 2 === 1 ? seg : seg
      .replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => `\n$$\n${m.trim()}\n$$\n`)
      .replace(/\\\((.+?)\\\)/g, (_, m) => `$${m.trim()}$`)))
    .join('');
}
