import { micromark } from 'micromark';

// Highlights are captured from the RENDERED answer but must be located in
// the markdown SOURCE for context tagging and stale-highlight pruning. The
// fuzzy pattern tolerates inline syntax, link destinations and common HTML
// entities; the reading surface marks the rendered text separately.
const MD_NOISE = '(?:\\]\\([^\\n)]*\\)|[*_`~()#>\\[\\]|-])*';
// A whitespace gap in the selection may be a BLOCK boundary in the source:
// "\n- item", "\n\n2. item", "\n> quote", " | " between table cells, or a
// whole table delimiter row ("|---|---|") between header and body. After
// the whitespace, allow any run of list/quote/heading/cell prefixes —
// without this, any highlight crossing a list item or table cell can
// never match.
// A code fence line ("```bash", "~~~") is one more such boundary: a
// selection running from prose into a code block or out of one.
const SPACE = '(?:\\s|&nbsp;|&#0*160;|&#x0*a0;)';
const WS_GAP = `${SPACE}+(?:(?:\\d{1,3}[.)]|[-*+>|]|#{1,6}|[-:|]{3,}|[\`~]{3,}[^\\s\`~]*)${SPACE}+)*`;
const ENTITIES: Record<string, string> = {
  '&': '(?:&amp;|&#0*38;|&#x0*26;|&)',
  '<': '(?:&lt;|&#0*60;|&#x0*3c;|<)',
  '>': '(?:&gt;|&#0*62;|&#x0*3e;|>)',
  '"': '(?:&quot;|&#0*34;|&#x0*22;|")',
  "'": "(?:&apos;|&#0*39;|&#x0*27;|')",
};

export function fuzzyHighlightRegex(text: string): RegExp | null {
  const chars = [...text.trim()];
  if (chars.length === 0) return null;
  const parts: string[] = [];
  let pendingWs = false;
  for (const ch of chars) {
    if (/\s/.test(ch)) { pendingWs = true; continue; }
    const escaped = ENTITIES[ch] ?? ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (parts.length === 0) parts.push(escaped);
    else if (pendingWs) parts.push(`${MD_NOISE}${WS_GAP}${MD_NOISE}${escaped}`);
    else parts.push(`${MD_NOISE}${escaped}`);
    pendingWs = false;
  }
  try {
    // Leading/trailing noise is swallowed into the match, so a wrapper
    // (<mark>, [Important]) encloses the WHOLE **bold** span instead of
    // splitting its delimiters apart.
    return new RegExp(MD_NOISE + parts.join('') + MD_NOISE, 'g');
  } catch {
    return null;
  }
}

/** True when a selection starts and ends inside the same code block: no mark
    can be drawn there, so the pen leaves it alone. */
export function withinOneCodeBlock(range: Range): boolean {
  const pre = (n: Node) => (n instanceof Element ? n : n.parentElement)?.closest('pre') ?? null;
  const a = pre(range.startContainer);
  return !!a && a === pre(range.endContainer);
}

// CommonMark may decode named or numeric entities and escapes that the source
// matcher cannot represent. This fallback keeps such visible marks on edits.
function renderedMarkdownText(source: string): string {
  const entities: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
  return micromark(source, { allowDangerousHtml: true })
    .replace(/<\/?(?:p|div|blockquote|li|pre|table|tr|td|th|h[1-6]|br)\b[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39);/g, entity => entities[entity])
    .replace(/\s+/g, ' ').trim();
}

export function highlightFoundIn(haystack: string, text: string): boolean {
  const re = fuzzyHighlightRegex(text);
  if (!re) return false;
  return re.test(haystack) || renderedMarkdownText(haystack).includes(text.replace(/\s+/g, ' ').trim());
}

/** Drop highlights that no longer appear in the (new) response text —
    called whenever a node's displayed answer changes (generation, version
    switch, manual edit), so ghost highlights never outlive their text. */
export function pruneHighlights<T extends { text: string }>(highlights: T[] | undefined, response: string): T[] {
  const list = highlights ?? [];
  const kept = list.filter((h) => highlightFoundIn(response, h.text));
  return kept.length === list.length ? list : kept;
}
