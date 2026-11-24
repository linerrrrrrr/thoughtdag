// Visualize emits a file reference on its own line in an assistant answer.
// Keep offsets in the original Markdown so adjacent prose and marks stay intact.
const marker = '\uE200visualize\uE202';
const endMarker = '\uE201';

export function parseCodexVisuals(text) {
  if (typeof text !== 'string' || !text.includes(marker)) return [];
  const refs = [];
  let fence = '';
  for (const line of text.matchAll(/[^\r\n]+|\r?\n|\r/g)) {
    const raw = line[0];
    const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(raw);
    if (delimiter) {
      const [, run, rest] = delimiter;
      if (fence) {
        if (run.startsWith(fence) && !rest.trim()) fence = '';
      } else if (run[0] !== '`' || !rest.includes('`')) {
        fence = run;
      }
      continue;
    }
    if (fence || !/^ {0,3}\uE200visualize\uE202/.test(raw)) continue;
    const trimmed = raw.trim();
    if (!trimmed.endsWith(endMarker)) continue;
    let ref;
    try { ref = JSON.parse(trimmed.slice(marker.length, -endMarker.length)); }
    catch { continue; }
    if (!ref || typeof ref.path !== 'string' || !/\.html$/i.test(ref.path)
        || !/^(?:\/(?!\/)|[A-Za-z]:[\\/])/.test(ref.path) || /[\x00-\x1f]/.test(ref.path)) continue;
    refs.push({ start: line.index, end: line.index + raw.length, path: ref.path,
      ...(typeof ref.title === 'string' && ref.title.trim() ? { title: ref.title.trim() } : {}),
      ...(ref.mode === 'wide' ? { mode: 'wide' } : {}) });
  }
  return refs;
}
