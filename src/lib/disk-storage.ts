import { get as browserGet, set as browserSet, del as browserDel, keys as browserKeys } from 'idb-keyval';

// Only this locator and browser-granted filesystem permissions remain in the
// browser. The canvas, attachments and settings are kept by the local host.
const LOCATOR_KEY = 'thoughtdag:disk-storage:locator:v1';
const BROWSER_ONLY_KEYS = new Set(['thoughtdag.backupDirHandle']);
const ENDPOINT = '/__thoughtdag_storage';
const ERROR_EVENT = 'thoughtdag:storage-error';
type Locator = { version: 1; namespace: string; origin: string };
type PathPart = string | number;
type Special = { path: PathPart[]; kind: string; value?: string; target?: PathPart[] };
type Encoded = { format: 1; value: unknown; special: Special[] };
type Space = 'kv' | 'settings';
export type StorageCandidate = { namespace: string; createdAt: string };
declare const __THOUGHTDAG_DISK_STORAGE_REQUIRED__: boolean | undefined;

export class StorageRecoveryRequired extends Error {
  candidates: StorageCandidate[];
  constructor(candidates: StorageCandidate[]) {
    super('Existing local data requires an explicit choice');
    this.candidates = candidates;
  }
}

let locator: Locator | null = null;
export function diskStorageNamespace(): string {
  return locator?.namespace ?? 'browser';
}
let storedSettings: Map<string, string> | null = null;
const pending = new Map<string, Promise<void>>();
const failed = new Set<string>();

/** Preserve structured-clone values used by the canvas, including empty and
 * undefined fields and repeated references. Unsupported types fail closed. */
export function encodeStoredValue(input: unknown): string {
  const special: Special[] = [];
  const seen = new Map<object, PathPart[]>();
  const visit = (value: unknown, at: PathPart[]): unknown => {
    if (value === undefined) { special.push({ path: at, kind: 'undefined' }); return null; }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      special.push({ path: at, kind: Number.isNaN(value) ? 'nan' : value > 0 ? 'infinity' : 'negative-infinity' });
      return null;
    }
    if (typeof value === 'number' && Object.is(value, -0)) { special.push({ path: at, kind: 'negative-zero' }); return 0; }
    if (typeof value === 'bigint') { special.push({ path: at, kind: 'bigint', value: String(value) }); return null; }
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return value;
    if (typeof value !== 'object') throw new Error('Unsupported storage value');
    const prior = seen.get(value);
    if (prior) { special.push({ path: at, kind: 'reference', target: prior }); return null; }
    seen.set(value, at);
    if (value instanceof Date) { special.push({ path: at, kind: 'date', value: value.toISOString() }); return null; }
    if (Array.isArray(value)) {
      return Array.from({ length: value.length }, (_, index) => {
        if (!(index in value)) { special.push({ path: [...at, index], kind: 'hole' }); return null; }
        return visit(value[index], [...at, index]);
      });
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) throw new Error('Unsupported storage value');
    const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const [key, child] of Object.entries(value)) out[key] = visit(child, [...at, key]);
    return out;
  };
  return JSON.stringify({ format: 1, value: visit(input, []), special } satisfies Encoded);
}

export function decodeStoredValue(text: string): unknown {
  const parsed = JSON.parse(text) as Encoded;
  if (parsed.format !== 1 || !Array.isArray(parsed.special)) throw new Error('Invalid storage record');
  const holder: { value: unknown } = { value: parsed.value };
  const parentAt = (at: PathPart[]) => {
    let parent: unknown = holder;
    for (const part of ['value', ...at.slice(0, -1)]) {
      if (!parent || typeof parent !== 'object' || !Object.hasOwn(parent, part)) throw new Error('Invalid storage record path');
      parent = (parent as Record<string | number, unknown>)[part];
    }
    return parent as Record<string | number, unknown>;
  };
  const readAt = (at: PathPart[]): unknown => {
    let value: unknown = holder.value;
    for (const part of at) {
      if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) throw new Error('Invalid storage reference');
      value = (value as Record<string | number, unknown>)[part];
    }
    return value;
  };
  const setAt = (at: PathPart[], value: unknown, remove = false) => {
    if (at.length === 0) { holder.value = value; return; }
    const parent = parentAt(at);
    const key = at[at.length - 1];
    if (remove) delete parent[key];
    else Object.defineProperty(parent, key, { value, enumerable: true, writable: true, configurable: true });
  };
  for (const item of parsed.special.filter((x) => x.kind !== 'reference')) {
    switch (item.kind) {
      case 'undefined': setAt(item.path, undefined); break;
      case 'hole': setAt(item.path, undefined, true); break;
      case 'nan': setAt(item.path, NaN); break;
      case 'infinity': setAt(item.path, Infinity); break;
      case 'negative-infinity': setAt(item.path, -Infinity); break;
      case 'negative-zero': setAt(item.path, -0); break;
      case 'bigint': setAt(item.path, BigInt(item.value ?? '')); break;
      case 'date': setAt(item.path, new Date(item.value ?? '')); break;
      default: throw new Error('Unsupported storage record');
    }
  }
  for (const item of parsed.special.filter((x) => x.kind === 'reference')) {
    if (!item.target) throw new Error('Invalid storage reference');
    setAt(item.path, readAt(item.target));
  }
  return holder.value;
}

async function request(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(ENDPOINT, {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'content-type': 'application/json', 'x-thoughtdag-storage': '1' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Local storage is unavailable (${response.status})`);
  return await response.json() as Record<string, unknown>;
}

async function hostVersion(): Promise<number | null> {
  try {
    const response = await fetch(ENDPOINT, { headers: { 'x-thoughtdag-storage': '1' }, cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return null;
    const value = await response.json() as { service?: string; version?: number };
    return value.service === 'thoughtdag-local-storage' && (value.version === 1 || value.version === 2) ? value.version : null;
  } catch { return null; }
}

function reportFailure(key?: string): void {
  if (key) failed.add(key);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(ERROR_EVENT));
}

function queueWrite(space: Space, key: string, op: 'set' | 'delete', value?: string): Promise<void> {
  if (!locator) return Promise.reject(new Error('Local storage is not initialized'));
  const id = `${space}:${key}`;
  const current = locator;
  const previous = pending.get(id) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    await request({ op, namespace: current.namespace, space, key, ...(op === 'set' ? { value } : {}) });
  });
  pending.set(id, next);
  void next.then(() => {
    failed.delete(id);
    if (pending.get(id) === next) pending.delete(id);
  }, () => {
    reportFailure(id);
    if (pending.get(id) === next) pending.delete(id);
  });
  return next;
}

async function diskRead(space: Space, key: string): Promise<unknown> {
  if (!locator) throw new Error('Local storage is not initialized');
  await pending.get(`${space}:${key}`);
  const response = await request({ op: 'get', namespace: locator.namespace, space, key });
  if (response.found === false) return undefined;
  if (response.found !== true || typeof response.value !== 'string') throw new Error('Invalid storage response');
  return decodeStoredValue(response.value);
}

export async function get<T = unknown>(key: IDBValidKey): Promise<T | undefined> {
  if (!locator || (typeof key === 'string' && BROWSER_ONLY_KEYS.has(key))) return browserGet<T>(key);
  if (typeof key !== 'string') throw new Error('Unsupported storage key');
  try { return await diskRead('kv', key) as T | undefined; }
  catch (error) { reportFailure(); throw error; }
}

export async function set(key: IDBValidKey, value: unknown): Promise<void> {
  if (!locator || (typeof key === 'string' && BROWSER_ONLY_KEYS.has(key))) return browserSet(key, value);
  if (typeof key !== 'string') throw new Error('Unsupported storage key');
  let encoded: string;
  try { encoded = encodeStoredValue(value); }
  catch (error) { reportFailure(`kv:${key}`); throw error; }
  return queueWrite('kv', key, 'set', encoded);
}

export async function del(key: IDBValidKey): Promise<void> {
  if (!locator || (typeof key === 'string' && BROWSER_ONLY_KEYS.has(key))) return browserDel(key);
  if (typeof key !== 'string') throw new Error('Unsupported storage key');
  return queueWrite('kv', key, 'delete');
}

export async function keys(): Promise<IDBValidKey[]> {
  if (!locator) return (await browserKeys()).filter((key) => key !== LOCATOR_KEY);
  const result = await request({ op: 'keys', namespace: locator.namespace, space: 'kv' });
  if (!Array.isArray(result.keys) || !result.keys.every((key) => typeof key === 'string')) throw new Error('Invalid storage response');
  const native = (await browserKeys()).filter((key) => typeof key === 'string' && BROWSER_ONLY_KEYS.has(key));
  return [...result.keys, ...native];
}

/** Synchronous reads preserve the existing settings API; writes are queued. */
export const appSettings = {
  getItem(key: string): string | null {
    return storedSettings ? storedSettings.get(key) ?? null : localStorage.getItem(key);
  },
  setItem(key: string, value: string): void {
    if (!storedSettings) { localStorage.setItem(key, value); return; }
    const text = String(value);
    storedSettings.set(key, text);
    void queueWrite('settings', key, 'set', encodeStoredValue(text)).catch(() => undefined);
  },
  removeItem(key: string): void {
    if (!storedSettings) { localStorage.removeItem(key); return; }
    storedSettings.delete(key);
    void queueWrite('settings', key, 'delete').catch(() => undefined);
  },
};

function browserSettings(): Map<string, string> {
  const result = new Map<string, string>();
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !(key === 'thoughtdag' || key.startsWith('thoughtdag.') || key.startsWith('thoughtdag:'))) continue;
    const value = localStorage.getItem(key);
    if (value !== null) result.set(key, value);
  }
  return result;
}

async function sourceKeys(): Promise<string[]> {
  const list = (await browserKeys()).filter((key) => key !== LOCATOR_KEY && !(typeof key === 'string' && BROWSER_ONLY_KEYS.has(key)));
  if (!list.every((key): key is string => typeof key === 'string')) throw new Error('Unsupported browser storage key');
  return list.sort();
}

function auditAttachments(values: Map<string, unknown>): void {
  for (const [key, original] of values) {
    if (key !== 'thoughtdag' && !key.startsWith('thoughtdag:project:')) continue;
    const envelope = (typeof original === 'string' ? JSON.parse(original) : original) as { state?: { nodes?: unknown[] } } | null;
    const nodes = Array.isArray(envelope?.state?.nodes) ? envelope.state.nodes : [];
    for (const node of nodes) {
      const attachments = (node as { data?: { attachments?: unknown[] } })?.data?.attachments;
      if (!Array.isArray(attachments)) continue;
      for (const item of attachments) {
        const att = item as { id?: string; contentInVault?: boolean; editedDocxRevision?: string; pdfFileRevision?: string };
        if (att?.contentInVault && (!att.id || !values.has(`att-content:${att.id}`))) throw new Error('An attachment source is missing');
        if (att?.editedDocxRevision && !values.has(`att-docx-revision:${att.editedDocxRevision}`)) throw new Error('A saved document revision is missing');
        if (att?.pdfFileRevision && !values.has(`att-pdf-revision:${att.pdfFileRevision}`)) throw new Error('A saved PDF revision is missing');
      }
    }
  }
}

async function migrateBrowserData(version: number, onProgress?: (message: string) => void): Promise<Locator> {
  const keysBefore = await sourceKeys();
  const preferences = browserSettings();
  const values = new Map<string, unknown>();
  const serialized = new Map<string, string>();
  for (const key of keysBefore) {
    const value = await browserGet(key);
    values.set(key, value);
    serialized.set(key, encodeStoredValue(value));
  }
  auditAttachments(values);
  const result: Locator = { version: 1, namespace: crypto.randomUUID(), origin: window.location.origin };
  await request({ op: 'create', namespace: result.namespace, origin: result.origin });
  let done = 0;
  const total = serialized.size + preferences.size;
  for (const [space, entries] of [['kv', serialized], ['settings', preferences]] as const) {
    for (const [key, value] of entries) {
      const encoded = space === 'settings' ? encodeStoredValue(value) : value;
      await request({ op: 'set', namespace: result.namespace, space, key, value: encoded });
      const copy = await request({ op: 'get', namespace: result.namespace, space, key });
      if (copy.found !== true || copy.value !== encoded) throw new Error('Local data verification failed');
      onProgress?.(`${++done}/${total}`);
    }
  }
  const keysAfter = await sourceKeys();
  if (JSON.stringify(keysBefore) !== JSON.stringify(keysAfter)) throw new Error('Browser data changed during migration');
  for (const [key, old] of serialized) {
    if (encodeStoredValue(await browserGet(key)) !== old) throw new Error('Browser data changed during migration');
  }
  if (JSON.stringify([...preferences].sort()) !== JSON.stringify([...browserSettings()].sort())) throw new Error('Browser settings changed during migration');
  if (version >= 2) await request({ op: 'finish', namespace: result.namespace, origin: result.origin });
  // The locator is committed only after all data has been written and read back.
  await browserSet(LOCATOR_KEY, result);
  return result;
}

async function openDisk(saved: Locator): Promise<void> {
  if (saved.version !== 1 || saved.origin !== window.location.origin) throw new Error('Storage locator does not match this page');
  await request({ op: 'open', namespace: saved.namespace, origin: saved.origin });
  locator = saved;
  try {
    const response = await request({ op: 'keys', namespace: saved.namespace, space: 'settings' });
    if (!Array.isArray(response.keys) || !response.keys.every((key) => typeof key === 'string')) throw new Error('Invalid settings index');
    const loaded = new Map<string, string>();
    for (const key of response.keys as string[]) {
      const value = await diskRead('settings', key);
      if (typeof value !== 'string') throw new Error('Invalid setting');
      loaded.set(key, value);
    }
    storedSettings = loaded;
  } catch (error) {
    locator = null;
    throw error;
  }
}

/** Must run before importing app modules that read settings at module scope. */
export async function initializeDiskStorage(onProgress?: (message: string) => void, choice?: string): Promise<'disk' | 'browser'> {
  // A shared viewer is a guest session and must not migrate local data.
  if (window.location.hash.startsWith('#view=')) return 'browser';
  const initialize = async (): Promise<'disk' | 'browser'> => {
    const saved = await browserGet<Locator>(LOCATOR_KEY);
    const version = await hostVersion();
    const required = typeof __THOUGHTDAG_DISK_STORAGE_REQUIRED__ !== 'undefined' && __THOUGHTDAG_DISK_STORAGE_REQUIRED__;
    if ((saved || required) && !version) throw new Error('The configured local data service is unavailable');
    if (!version) return 'browser';
    let selected = saved;
    if (!selected && version >= 2) {
      const response = await request({ op: 'list', origin: window.location.origin });
      if (!Array.isArray(response.namespaces)) throw new Error('Invalid storage recovery list');
      const candidates = response.namespaces as StorageCandidate[];
      if (!candidates.every((item) => typeof item.namespace === 'string' && typeof item.createdAt === 'string')) throw new Error('Invalid storage recovery list');
      if (candidates.length && !choice) throw new StorageRecoveryRequired(candidates);
      if (choice && choice !== 'new') {
        if (!candidates.some((item) => item.namespace === choice)) throw new Error('The selected local data is unavailable');
        selected = { version: 1, namespace: choice, origin: window.location.origin };
        await request({ op: 'open', namespace: choice, origin: selected.origin });
        await browserSet(LOCATOR_KEY, selected);
      }
    }
    selected ??= await migrateBrowserData(version, onProgress);
    await openDisk(selected);
    return 'disk';
  };
  if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request('thoughtdag-storage-migration', initialize);
  return initialize();
}

export function onDiskStorageError(listener: () => void): () => void {
  window.addEventListener(ERROR_EVENT, listener);
  if (failed.size) listener();
  return () => window.removeEventListener(ERROR_EVENT, listener);
}

export async function flushDiskWrites(): Promise<void> {
  await Promise.all([...pending.values()]);
  if (failed.size) throw new Error('Some local data could not be saved');
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (event) => {
    if (pending.size || failed.size) event.preventDefault();
  });
}
