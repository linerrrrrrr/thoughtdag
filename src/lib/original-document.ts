import { createStore, get, set } from 'idb-keyval';
import { useEffect, useSyncExternalStore } from 'react';
import type { Attachment } from '../types';
import type { MessageKey } from '../i18n';
import { loadAttachmentContent, loadDocumentContent } from './attachment-vault';
import { DOCX_MIME_TYPE, isDocxDocument } from './document-copy';
import { diskStorageNamespace } from './disk-storage';

type SourceHandle = FileSystemFileHandle & {
  requestPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
};
type OpenFilePicker = (options: {
  multiple?: boolean; id: string; types?: { description?: string; accept: Record<string, string[]> }[];
}) => Promise<SourceHandle[]>;

/** Only origin-local browser storage can hold a user's permission to write a file. */
interface DocumentSource {
  handle?: SourceHandle;
  originalDigest?: string;
  writtenDigest?: string;
  writtenRevision?: string;
}

export class DocumentSourceError extends Error {
  constructor(key: MessageKey) {
    super(key);
    this.key = key;
  }
  readonly key: MessageKey;
}

const store = createStore('thoughtdag-document-sources', 'handles');
const imports = new WeakMap<File, Promise<SourceHandle | undefined>>();
interface SourceState { ready: boolean; saving: boolean; source?: DocumentSource }
const initial: SourceState = { ready: false, saving: false };
const states = new Map<string, SourceState>();
const loading = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
const stateOf = (key: string) => states.get(key) ?? initial;
function update(key: string, patch: Partial<SourceState>) {
  states.set(key, { ...stateOf(key), ...patch });
  listeners.forEach(notify => notify());
}
function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => { listeners.delete(notify); };
}

export function documentSourceKey(projectId: string, nodeId: string, attachmentId: string): string {
  return JSON.stringify([diskStorageNamespace(), projectId, nodeId, attachmentId]);
}

function picker(): OpenFilePicker | undefined {
  const browser = window as Window & { showOpenFilePicker?: OpenFilePicker };
  return browser.showOpenFilePicker?.bind(browser);
}

function canWriteFile(file: File): boolean {
  return isDocxDocument(file) || file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

/** Capture drag capabilities in the event turn, before the data transfer expires. */
export function droppedFiles(transfer: DataTransfer): File[] {
  const files: File[] = [];
  for (const item of Array.from(transfer.items)) {
    const file = item.kind === 'file' ? item.getAsFile() : null;
    if (!file) continue;
    files.push(file);
    const entry = item as DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> };
    if (canWriteFile(file) && entry.getAsFileSystemHandle) {
      try {
        imports.set(file, entry.getAsFileSystemHandle().then(handle =>
          handle?.kind === 'file' ? handle as SourceHandle : undefined).catch(() => undefined));
      } catch { /* Some clipboard and embedded views only provide a File. */ }
    }
  }
  return files.length ? files : Array.from(transfer.files);
}

/** Keep the ordinary input for hosts which only support importing a snapshot. */
export async function chooseMaterialFiles(input: HTMLInputElement | null, acceptFiles: (files: File[]) => void | Promise<void>): Promise<void> {
  if (!input) return;
  const open = picker();
  if (!open) { input.click(); return; }
  let handles: SourceHandle[];
  try {
    handles = await open({ multiple: true, id: 'thoughtdag-materials', types: [{ accept: {
      'image/*': [], 'application/octet-stream': input.accept.split(',').filter(ext => ext.startsWith('.')),
    } }] });
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'AbortError')) input.click();
    return;
  }
  const files = await Promise.all(handles.map(async handle => {
    const file = await handle.getFile();
    if (canWriteFile(file)) imports.set(file, Promise.resolve(handle));
    return file;
  }));
  await acceptFiles(files);
}

export function rememberImportedDocument(key: string, file: File): void {
  const acquired = imports.get(file);
  if (!acquired) return;
  const pending = acquired.then(async handle => {
    if (handle) await rememberSource(key, { handle });
    else update(key, { ready: true });
  }).finally(() => { if (loading.get(key) === pending) loading.delete(key); });
  loading.set(key, pending);
}

function loadSource(key: string) {
  if (stateOf(key).ready) return Promise.resolve();
  const existing = loading.get(key);
  if (existing) return existing;
  const pending = get<DocumentSource>(key, store).catch(() => undefined).then(source => {
    if (loading.get(key) === pending) {
      update(key, { source, ready: true });
      loading.delete(key);
    }
  });
  loading.set(key, pending);
  return pending;
}

export function useOriginalDocument(key: string): SourceState {
  useEffect(() => { void loadSource(key); }, [key]);
  return useSyncExternalStore(subscribe, () => stateOf(key));
}

function rememberSource(key: string, source: DocumentSource): Promise<void> {
  update(key, { source, ready: true });
  // A storage quota failure cannot undo a completed physical write. Keep the
  // permission in this session; another session can select the original again.
  return set(key, source, store).catch(() => undefined);
}

export function cachedDocxRevision(att: Attachment): string | undefined {
  return att.editedDocxRevision ?? att.editedDocxSavedAt ?? (att.editedDocxContent ? 'inline' : undefined);
}

/** Request permission during the save gesture, before expensive DOCX export. */
async function chooseOriginal(source: DocumentSource | undefined, attachment: Attachment): Promise<SourceHandle | null> {
  let handle = source?.handle;
  if (!handle) {
    const open = picker();
    if (!open) throw new DocumentSourceError('document.writeUnsupported');
    try {
      const accept: Record<string, string[]> = isDocxDocument(attachment) ? { [DOCX_MIME_TYPE]: ['.docx'] } : { 'application/pdf': ['.pdf'] };
      [handle] = await open({ id: 'thoughtdag-original', types: [{ description: attachment.name, accept }] });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return null;
      throw new DocumentSourceError('document.pickerUnavailable');
    }
    if (!handle) return null;
    if (handle.name.toLowerCase() !== attachment.name.toLowerCase()) throw new DocumentSourceError('document.wrongOriginal');
  }
  if (handle.requestPermission && await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') {
    throw new DocumentSourceError('document.writePermission');
  }
  return handle;
}

export function documentBlob(content: string, type: string): Blob {
  if (!content) throw new DocumentSourceError('document.originalUnavailable');
  const decoded = atob(content);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < bytes.length; index++) bytes[index] = decoded.charCodeAt(index);
  return new Blob([bytes], { type });
}

async function digest(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** A legacy document can be reconnected to its imported bytes or to the exact
 * working version the user already exported. A name alone never authorizes a replacement. */
async function checkOriginal(file: File, source: DocumentSource | undefined, attachment: Attachment) {
  const current = await digest(file);
  const original = await loadAttachmentContent(attachment);
  const originalDigest = original ? await digest(documentBlob(original, attachment.type)) : undefined;
  if (source?.writtenDigest) {
    if (source.originalDigest !== originalDigest || current !== source.writtenDigest) throw new DocumentSourceError('document.originalChanged');
    return originalDigest;
  }
  if (current === originalDigest) return originalDigest;
  if (isDocxDocument(attachment) && cachedDocxRevision(attachment)) {
    const saved = await loadDocumentContent(attachment);
    if (saved && current === await digest(documentBlob(saved, DOCX_MIME_TYPE))) return originalDigest;
  }
  throw new DocumentSourceError(source ? 'document.originalChanged' : 'document.wrongOriginal');
}

/** Native writable streams replace the on-disk file on close. Check the disk
 * contents and the initiating editor immediately before committing the swap. */
async function writeOriginalDocument(handle: SourceHandle, source: DocumentSource | undefined, attachment: Attachment,
  blob: Blob, revision: string | undefined, assertCurrent: () => void): Promise<{ source: DocumentSource; path?: string }> {
  const writtenDigest = await digest(blob);
  const write = async () => {
    assertCurrent();
    const options = { keepExistingData: false, mode: 'exclusive' } as const;
    const stream = await handle.createWritable(options);
    try {
      await stream.write(blob);
      const file = await handle.getFile();
      const originalDigest = await checkOriginal(file, source, attachment);
      let sourcePath: string | undefined;
      try { sourcePath = window.desktop?.getPathForFile?.(file) || undefined; } catch { /* Path display is optional. */ }
      assertCurrent();
      await stream.close();
      return { source: { handle, originalDigest, writtenDigest, writtenRevision: revision }, path: sourcePath };
    } catch (error) {
      await stream.abort().catch(() => undefined);
      throw error;
    }
  };
  // Includes older engines that ignore the exclusive writable-stream option.
  return navigator.locks
    ? navigator.locks.request('thoughtdag-save-document:' + handle.name.toLowerCase(), write)
    : write();
}

/** The picker and permission request start in the Save gesture. A successful
 * close is the commit point for both document formats and both UI surfaces. */
export async function saveToOriginal(key: string, attachment: Attachment,
  prepare: () => Promise<{ blob: Blob; revision?: string }>, assertCurrent: () => void) {
  if (!stateOf(key).ready) await loadSource(key);
  const { source, saving } = stateOf(key);
  if (saving) return null;
  assertCurrent();
  update(key, { saving: true });
  try {
    const handle = await chooseOriginal(source, attachment);
    if (!handle) return null;
    const { blob, revision } = await prepare();
    const result = await writeOriginalDocument(handle, source, attachment, blob, revision, assertCurrent);
    await rememberSource(key, result.source);
    return { ...result, reconnected: !source?.handle };
  } catch (error) {
    if (source?.handle && error instanceof DOMException && error.name === 'NotFoundError') {
      await rememberSource(key, { ...source, handle: undefined });
    }
    throw error;
  } finally { update(key, { saving: false }); }
}

export function documentWriteError(error: unknown): MessageKey {
  if (error instanceof DocumentSourceError) return error.key;
  if (error instanceof DOMException && ['NotAllowedError', 'SecurityError'].includes(error.name)) return 'document.writePermission';
  if (error instanceof DOMException && error.name === 'NotFoundError') return 'document.originalMissing';
  return 'document.writeFailed';
}
