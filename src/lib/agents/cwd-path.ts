/** Parse a folder pasted for the runtime host, whose OS may differ from the
 *  browser's. Preserve separators and casing; the host resolves the path. */
export function parseAgentCwd(input: string): string | null {
  let value = input.trim();
  // File explorers and shells commonly copy an absolute path with quotes.
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'")))) value = value.slice(1, -1);
  if (!value || value.includes('\0') || value.includes('\n') || value.includes('\r')) return null;
  const posix = value.startsWith('/');
  const drive = /^[a-z]:[\\/]/i.test(value);
  const unc = /^\\\\[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/.test(value);
  // A drive-relative path (C:folder) or a root on an unspecified drive
  // (\folder) cannot unambiguously select the runtime's working directory.
  return posix || drive || unc ? value : null;
}
