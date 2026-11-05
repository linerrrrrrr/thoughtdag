/** File actions share the host that runs the agent, including a harness host. */
export function installLocalFilesBridge(apiBase: string): void {
  if (window.desktopLocal) return;
  const api = apiBase.replace(/\/+$/, '');
  const call = async <T,>(action: string, path: string): Promise<T> => {
    const result = await fetch(`${api}/local/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ path }),
    });
    if (!result.ok) throw new Error(`File service: ${result.status}`);
    return result.json() as Promise<T>;
  };
  window.desktopLocal = {
    open: path => call('open', path), reveal: path => call('reveal', path),
    read: path => call('read', path), image: path => call('image', path),
  };
}
