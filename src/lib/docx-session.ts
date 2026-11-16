import type { SuperDoc } from 'superdoc';
import type { Attachment } from '../types';
import { useStore } from '../store';
import { useProjects } from '../store/projects';
import { loadDocumentContent, saveDocumentRevision } from './attachment-vault';
import { DOCX_MIME_TYPE } from './document-copy';
import { cachedDocxRevision, documentBlob, documentSourceKey, DocumentSourceError, saveToOriginal } from './original-document';
import { isViewerMode } from './viewer';
import { handleDismissableLayerKeyDown } from './use-dismissable-layer';
import { createDocxViewport } from './docx-viewport';

export interface DocxSession {
  key: string;
  projectId: string;
  nodeId: string;
  attachment: Attachment;
  revision: string | undefined;
  element: HTMLDivElement;
  hosts: Set<HTMLElement>;
  hostReadOnly: Map<HTMLElement, boolean>;
  owner: HTMLElement | null;
  instance: SuperDoc | null;
  viewport: ReturnType<typeof createDocxViewport>;
  status: 'loading' | 'ready' | 'error';
  dirty: boolean;
  saving: boolean;
  conflict: boolean;
  missingFonts: string[];
  started: boolean;
  generation: number;
  stopObserve?: () => void;
  releaseTimer?: ReturnType<typeof setTimeout>;
}

// Sessions own the document, selection and undo history. React hosts own only
// their placement. Moving focus or opening the reader never recreates a file.
const sessions = new Map<string, DocxSession>();
const listeners = new Set<() => void>();
let serial = 0;
let active: DocxSession | null = null;
export const subscribeDocx = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const docxSnapshot = () => serial;
export const activeDocxSession = () => active;
function emit() { serial++; listeners.forEach(listener => listener()); }

function ownerIsReadOnly(session: DocxSession) {
  return session.owner ? session.hostReadOnly.get(session.owner) === true : true;
}

function applyOwnerMode(session: DocxSession) {
  session.instance?.setDocumentMode(ownerIsReadOnly(session) ? 'viewing' : 'editing');
}

function cancelRelease(session: DocxSession) {
  if (session.releaseTimer !== undefined) clearTimeout(session.releaseTimer);
  session.releaseTimer = undefined;
}

function scheduleRelease(session: DocxSession) {
  cancelRelease(session);
  if (session.hosts.size || session.dirty || session.saving) return;
  // Switching nodes leaves their hosts mounted. Only documents that have
  // actually left every view are eligible; the delay tolerates StrictMode.
  session.releaseTimer = setTimeout(() => {
    if (session.hosts.size || session.dirty || session.saving) return;
    session.generation++;
    session.stopObserve?.();
    session.stopObserve = undefined;
    session.viewport.dispose();
    session.instance?.destroy();
    session.instance = null;
    session.element.remove();
    session.element.replaceChildren();
    session.started = false;
    session.status = 'loading';
    if (sessions.get(session.key) === session) sessions.delete(session.key);
    if (active === session) active = null;
    emit();
  }, 60_000);
}

export function activateDocx(session: DocxSession | null) {
  if (active === session) return;
  active = session;
  emit();
}

export function getDocxSession(projectId: string, nodeId: string, attachment: Attachment): DocxSession {
  const key = `${projectId}:${nodeId}:${attachment.id}`;
  const existing = sessions.get(key);
  if (existing) return existing;
  const element = document.createElement('div');
  element.className = 'docx-engine';
  element.dataset.superdocScroll = attachment.id;
  const session: DocxSession = {
    key, projectId, nodeId, attachment, revision: attachment.editedDocxRevision,
    element, hosts: new Set(), hostReadOnly: new Map(), owner: null, instance: null,
    viewport: createDocxViewport(element, () => session.instance),
    status: 'loading', dirty: false, saving: false, conflict: false,
    missingFonts: [], started: false, generation: 0,
  };
  if (import.meta.env.DEV) Object.defineProperty(element, '__docxSession', { get: () => session });
  element.addEventListener('focusin', () => activateDocx(session));
  element.addEventListener('pointerdown', () => activateDocx(session));
  // The native document runtime also listens beyond its DOM root. Ordinary
  // keys must reach it; application shortcuts explicitly exclude this surface.
  element.addEventListener('keydown', event => {
    if (event.key === 'Escape' || event.key === 'Tab') handleDismissableLayerKeyDown(event);
  });
  sessions.set(key, session);
  return session;
}

export function claimDocxHost(session: DocxSession, host: HTMLElement) {
  if (!session.hosts.has(host)) return;
  if (session.owner === host) return;
  cancelRelease(session);
  const instance = session.instance;
  const generation = session.generation;
  const selection = instance?.ui.selection.capture();
  session.viewport.attach(null);
  host.appendChild(session.element);
  session.owner = host;
  session.viewport.attach(host);
  applyOwnerMode(session);
  requestAnimationFrame(() => {
    if (session.owner !== host || session.generation !== generation || session.instance !== instance) return;
    if (selection) session.instance?.ui.selection.restore(selection);
  });
  emit();
}

export function attachDocxHost(session: DocxSession, host: HTMLElement) {
  cancelRelease(session);
  session.hosts.add(host);
  if (!session.hostReadOnly.has(host)) session.hostReadOnly.set(host, false);
  claimDocxHost(session, host);
  void startDocxSession(session);
  return () => {
    session.hosts.delete(host);
    session.hostReadOnly.delete(host);
    if (session.owner === host) {
      const remaining = [...session.hosts].at(-1);
      if (remaining) claimDocxHost(session, remaining);
      else {
        session.viewport.attach(null);
        session.element.remove();
        session.owner = null;
        if (active === session) active = null;
        emit();
      }
    }
    scheduleRelease(session);
  };
}

/** The visible host owns interaction mode. A hidden read-only preview must
 * never disable an editable canvas host, or enable a read-only owner. */
export function updateDocxHostMode(session: DocxSession, host: HTMLElement, readOnly: boolean) {
  session.hostReadOnly.set(host, readOnly);
  if (session.owner === host) applyOwnerMode(session);
}

export async function startDocxSession(session: DocxSession, reload = false) {
  if (session.started && !reload) return;
  session.started = true;
  const generation = ++session.generation;
  session.stopObserve?.();
  session.stopObserve = undefined;
  session.instance?.destroy();
  session.instance = null;
  session.element.replaceChildren();
  session.status = 'loading';
  session.dirty = false;
  session.conflict = false;
  session.missingFonts = [];
  emit();
  try {
    const [content, { SuperDoc }] = await Promise.all([
      loadDocumentContent(session.attachment), import('superdoc'),
    ]);
    if (generation !== session.generation) return;
    if (!content) throw new Error('Document bytes are unavailable');
    const bytes = Uint8Array.from(atob(content), char => char.charCodeAt(0));
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('Invalid DOCX');
    session.instance = new SuperDoc({
      selector: session.element,
      document: new File([bytes], session.attachment.name, { type: DOCX_MIME_TYPE }),
      documentMode: ownerIsReadOnly(session) ? 'viewing' : 'editing',
      contained: true,
      viewOptions: { layout: 'print' },
      // The viewport adapter separates document zoom from ancestor canvas/UI scale.
      zoom: { mode: 'manual', initial: 100 },
      ui: { toolbar: false, comments: false },
      telemetry: { enabled: false },
      onReady: ({ superdoc }) => {
        if (generation !== session.generation) return;
        session.instance = superdoc;
        session.status = 'ready';
        session.revision = session.attachment.editedDocxRevision;
        applyOwnerMode(session);
        session.viewport.engineReady();
        session.stopObserve = superdoc.ui.document.observe(state => {
          if (generation !== session.generation) return;
          if (session.dirty === state.dirty) return;
          session.dirty = state.dirty;
          scheduleRelease(session);
          emit();
        });
        emit();
      },
      onViewportChange: () => {
        if (generation === session.generation) session.viewport.refresh();
      },
      onZoomChange: payload => {
        if (generation === session.generation && session.status === 'ready') session.viewport.engineZoomChanged(payload);
      },
      onFontsChanged: ({ missingFonts }) => {
        if (generation !== session.generation) return;
        session.missingFonts = missingFonts ?? [];
        emit();
      },
      onContentError: () => { if (generation === session.generation) { session.status = 'error'; emit(); } },
      onException: () => {
        if (generation !== session.generation) return;
        if (session.status !== 'ready') { session.status = 'error'; emit(); }
      },
    });
  } catch {
    if (generation === session.generation) { session.status = 'error'; emit(); }
  }
}

export function updateDocxAttachment(session: DocxSession, attachment: Attachment) {
  session.attachment = attachment;
  if (session.revision === attachment.editedDocxRevision || !session.started) {
    if (session.conflict) { session.conflict = false; emit(); }
    return;
  }
  if (session.dirty) {
    if (!session.conflict) { session.conflict = true; emit(); }
  } else {
    session.revision = attachment.editedDocxRevision;
    void startDocxSession(session, true);
  }
}

export async function saveDocxSession(session: DocxSession) {
  const instance = session.instance;
  if (!instance || session.saving || session.status !== 'ready') return;
  if (useProjects.getState().switching) throw new Error('The canvas is switching; the draft is retained.');
  if (isViewerMode || ownerIsReadOnly(session) || session.conflict) throw new Error('This document cannot be saved from the current view.');
  const generation = session.generation;
  const attachmentId = session.attachment.id;
  const baseRevision = session.revision;
  session.saving = true;
  emit();
  try {
    const version = instance.ui.document.getVersion();
    if (version === null) throw new Error('The document version is unavailable.');
    const attachment = session.attachment;
    const currentAttachment = () => {
      const projects = useProjects.getState();
      if (projects.switching || (projects.activeId ?? 'default') !== session.projectId) return undefined;
      return useStore.getState().nodes.find(node => node.id === session.nodeId)?.data.attachments?.find(att => att.id === attachmentId);
    };
    const assertCurrent = () => {
      const current = currentAttachment();
      if (!current || generation !== session.generation || session.instance !== instance || ownerIsReadOnly(session)
        || instance.ui.document.getVersion() !== version || current.editedDocxRevision !== baseRevision) {
        throw new DocumentSourceError('document.editChanged');
      }
    };
    let patch: Partial<Attachment> = {};
    const result = await saveToOriginal(documentSourceKey(session.projectId, session.nodeId, attachmentId), attachment, async () => {
      assertCurrent();
      if (!session.dirty) {
        return { blob: documentBlob(await loadDocumentContent(attachment), DOCX_MIME_TYPE), revision: cachedDocxRevision(attachment) };
      }
      const blob = await instance.export({ exportType: ['docx'], triggerDownload: false });
      const { extractRawText } = await import('mammoth');
      const { value: text } = await extractRawText({ arrayBuffer: await blob.arrayBuffer() });
      assertCurrent();
      const revision = await saveDocumentRevision(attachment, blob);
      const previousCopy = cachedDocxRevision(attachment) ? {} : {
        legacyDocumentHtml: attachment.legacyDocumentHtml ?? attachment.editedHtml,
        legacyDocumentText: attachment.legacyDocumentText ?? attachment.editedText,
      };
      patch = { ...revision, ...previousCopy, editedText: text, editedHtml: undefined };
      return { blob, revision: revision.editedDocxRevision };
    }, assertCurrent);
    const current = currentAttachment();
    if (!result || !current || current.editedDocxRevision !== baseRevision || generation !== session.generation) return;
    if ((result.path || result.reconnected) && result.path !== current.sourcePath) patch.sourcePath = result.path;
    if (!Object.keys(patch).length) return;
    session.attachment = { ...current, ...patch };
    session.revision = session.attachment.editedDocxRevision;
    useStore.getState().pushHistory();
    useStore.getState().setAttachmentData(session.nodeId, attachmentId, patch);
    useStore.getState().pushHistory();
    instance.ui.document.markClean(version);
    session.conflict = false;
  } finally {
    session.saving = false;
    scheduleRelease(session);
    emit();
  }
}

export async function exportDocxSession(session: DocxSession) {
  if (!session.instance || session.status !== 'ready') return;
  const blob = await session.instance.export({ exportType: ['docx'], triggerDownload: false });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = session.attachment.name.replace(/\.docx$/i, '') + '.docx';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

// Browser navigation can discard unsaved file sessions; changing canvas focus
// cannot. No save or other side effect is triggered by this guard.
const beforeUnload = (event: BeforeUnloadEvent) => {
  if (![...sessions.values()].some(session => session.dirty)) return;
  event.preventDefault();
};
window.addEventListener('beforeunload', beforeUnload);

if (import.meta.hot) import.meta.hot.dispose(() => {
  window.removeEventListener('beforeunload', beforeUnload);
  sessions.forEach(session => { cancelRelease(session); session.generation++; session.stopObserve?.(); session.viewport.dispose(); session.instance?.destroy(); });
  sessions.clear();
});
