import { createServer } from 'vite';

// Vite 7 resolves port 0 to its normal dev port. Start tests in a separate
// range so concurrent runs can advance to the next port without serving 5173.
export function createTestServer(config) {
  return createServer({
    cacheDir: 'node_modules/.vite-tests',
    ...config,
    server: { ...config.server, host: '127.0.0.1', port: 15173, strictPort: false },
  });
}
