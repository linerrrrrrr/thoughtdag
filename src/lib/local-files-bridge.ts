/** File actions share the host that runs the agent, including a harness host. */
export function installLocalFilesBridge(apiBase: string): void {
  if (window.desktopLocal) return;
  const api = apiBase.replace(/\/+$/, '');
  const host = new URL(api || '/', window.location.origin);
  const capture = host.origin === window.location.origin || ['localhost', '127.0.0.1', '[::1]'].includes(host.hostname);
  const call = async <T,>(action: string, path: string, threadId?: string): Promise<T> => {
    const result = await fetch(`${api}/local/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ path, threadId }),
    });
    if (!result.ok) throw new Error(`File service: ${result.status}`);
    return result.json() as Promise<T>;
  };
  window.desktopLocal = {
    ...(capture && { codexVisual: ({ path, threadId }) => call<string | null>('codex-visual', path, threadId) }),
    open: path => call('open', path), reveal: path => call('reveal', path),
    read: path => call('read', path), image: path => call('image', path),
  };
}
