export interface LocalTarget { path: string; line?: number; column?: number }

const decode = (s: string): string => { try { return decodeURIComponent(s); } catch { return s; } };
const drive = /^[a-z]:[\\/]/i;
const hasControl = (s: string): boolean => [...s].some(c => c.charCodeAt(0) < 32);

/** Recognize file references before the browser can turn them into app routes.
 * Network shares and executable URL schemes are deliberately not local files. */
export function localTargetOf(href: string | undefined | null, base?: string | null): LocalTarget | null {
  if (!href || hasControl(href)) return null;
  let value = href;
  if (/^file:/i.test(value)) {
    try {
      const url = new URL(value);
      if (url.hostname && url.hostname !== 'localhost') return null;
      value = url.pathname + url.hash;
    } catch { return null; }
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !drive.test(value)) return null;
  value = decode(value).replace(/\\/g, '/');
  if (hasControl(value) || value.startsWith('//')) return null;
  if (/^\/[a-z]:\//i.test(value)) value = value.slice(1);
  let line: number | undefined, column: number | undefined;
  const location = value.match(/(?::(\d+)(?::(\d+))?|#L(\d+)(?:C(\d+))?(?:-L?\d+(?:C\d+)?)?)$/i);
  if (location) {
    line = Number(location[1] ?? location[3]) || undefined;
    column = Number(location[2] ?? location[4]) || undefined;
    value = value.slice(0, location.index);
  }
  if (!value || value.startsWith('#') || value.startsWith('?')) return null;
  if (!value.startsWith('/') && !value.startsWith('~/') && !drive.test(value)) {
    if (!base) return null;
    const root = localTargetOf(base);
    if (!root) return null;
    value = `${root.path.replace(/\/$/, '')}/${value}`;
  }
  const prefix = drive.test(value) ? value.slice(0, 3) : value.startsWith('~/') ? '~/' : '/';
  const parts: string[] = [];
  for (const part of value.slice(prefix.length).split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop(); else parts.push(part);
  }
  return { path: prefix + parts.join('/'), ...(line ? { line } : {}), ...(column ? { column } : {}) };
}

export const basenameOf = (path: string): string => path.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? path;

/** Only these web schemes may reach the browser; local hrefs are intercepted. */
export function safeMarkdownUrl(url: string): string {
  if (localTargetOf(url)) return url;
  if (/^(?:https?:|mailto:)/i.test(url)) return url;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url) && !/^[\\]{2}/.test(url) && !hasControl(url)) return url;
  return '';
}
