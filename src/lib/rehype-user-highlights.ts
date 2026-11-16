import type { Element, ElementContent, Root, RootContent, Text } from 'hast';

type TextParent = Root | Element;
type TextChunk = { node: Text; parent: TextParent; ranges: [number, number][] };
type TextPosition = { chunk: TextChunk; offset: number } | null;

const BLOCKS = new Set(['p', 'div', 'blockquote', 'li', 'pre', 'table', 'tr', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/** Mark rendered text, so a selection cannot split Markdown links or emphasis. */
export function rehypeUserHighlights(highlights: readonly string[]) {
  return (tree: Root) => {
    const chunks: TextChunk[] = [];
    const positions: TextPosition[] = [];
    const characters: string[] = [];
    let lastWasSpace = true;
    const boundary = () => {
      if (!lastWasSpace) { characters.push(' '); positions.push(null); lastWasSpace = true; }
    };
    const walk = (node: Root | RootContent, parent: TextParent | null, inCodeBlock: boolean) => {
      if (node.type === 'text' && parent) {
        const chunk: TextChunk = { node, parent, ranges: [] };
        chunks.push(chunk);
        for (let i = 0; i < node.value.length; i++) {
          const char = node.value[i];
          if (/\s/.test(char)) {
            if (lastWasSpace) continue;
            characters.push(' ');
            lastWasSpace = true;
          } else { characters.push(char); lastWasSpace = false; }
          positions.push(inCodeBlock ? null : { chunk, offset: i });
        }
        return;
      }
      if (node.type !== 'root' && node.type !== 'element') return;
      // KaTeX's MathML duplicates its visual text and is not a reading surface.
      if (node.type === 'element' && Array.isArray(node.properties.className)
        && node.properties.className.includes('katex-mathml')) return;
      const block = node.type === 'element' && BLOCKS.has(node.tagName);
      if (block || (node.type === 'element' && node.tagName === 'br')) boundary();
      const code = inCodeBlock || (node.type === 'element' && node.tagName === 'pre');
      for (const child of node.children) walk(child, node, code);
      if (block) boundary();
    };
    walk(tree, null, false);
    const text = characters.join('');

    for (const highlight of highlights) {
      const needle = highlight.replace(/\s+/g, ' ').trim();
      if (!needle) continue;
      let start = 0;
      while ((start = text.indexOf(needle, start)) !== -1) {
        for (let i = start; i < start + needle.length; i++) {
          const position = positions[i];
          if (!position) continue;
          const ranges = position.chunk.ranges;
          const last = ranges.at(-1);
          if (last?.[1] === position.offset) last[1]++;
          else ranges.push([position.offset, position.offset + 1]);
        }
        start += needle.length;
      }
    }

    for (const chunk of chunks) {
      if (!chunk.ranges.length) continue;
      chunk.ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const merged: [number, number][] = [];
      for (const range of chunk.ranges) {
        const last = merged.at(-1);
        if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
        else merged.push([...range]);
      }
      const children: ElementContent[] = [];
      let cursor = 0;
      for (const [start, end] of merged) {
        if (start > cursor) children.push({ type: 'text', value: chunk.node.value.slice(cursor, start) });
        children.push({ type: 'element', tagName: 'mark', properties: { className: ['highlight-mark'] },
          children: [{ type: 'text', value: chunk.node.value.slice(start, end) }] });
        cursor = end;
      }
      if (cursor < chunk.node.value.length) children.push({ type: 'text', value: chunk.node.value.slice(cursor) });
      const index = chunk.parent.children.indexOf(chunk.node);
      if (index >= 0) chunk.parent.children.splice(index, 1, ...children);
    }
  };
}
