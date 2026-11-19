import { diskStorageNamespace } from './disk-storage';

export interface ManagedFileKey {
  canvasId: string;
  nodeId: string;
  attachmentId: string;
  name: string;
}

export interface ManagedDocumentPreview {
  baseRevision: string;
  before: string;
  after: string;
}

export interface ManagedFileChange {
  nodeId: string;
  attachmentId: string;
  revision: string;
  changed: boolean;
  preview?: ManagedDocumentPreview;
}

export interface ManagedFileState {
  path: string;
  previewPath: string;
  revision: string;
  base64?: string;
  conflict?: boolean;
}

export type ManagedFileOperation =
  | { op: 'clearPreview'; expectedRevision: string }
  | { op: 'ensure'; base64: string }
  | { op: 'read'; knownRevision?: string }
  | { op: 'write'; expectedRevision: string; base64: string };
type ProbeItem = ManagedFileKey & { knownRevision: string };
type DocumentRequest = (ManagedFileKey & ManagedFileOperation) | { op: 'probe'; items: ProbeItem[] } | { op: 'deleteCanvas'; canvasId: string };
export type HostDocumentRequest = DocumentRequest & { namespace: string };
export type HostDocumentResponse = ManagedFileState | ManagedFileChange[] | { removed: true } | { missing: true };

function browserNamespace(): string {
  const key = 'thoughtdag:managed-document-namespace';
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(key, id);
  return id;
}

async function callHost(request: DocumentRequest): Promise<HostDocumentResponse | null> {
  if (typeof window === 'undefined' || window.location.hash.startsWith('#view=')) return null;
  const namespace = diskStorageNamespace();
  if (namespace !== 'browser') {
    const response = await fetch('/__thoughtdag_storage', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'content-type': 'application/json', 'x-thoughtdag-storage': '1' },
      body: JSON.stringify({ op: 'document', namespace, origin: window.location.origin, request }),
    });
    if (!response.ok) throw new Error(`Managed document is unavailable (${response.status})`);
    return response.json() as Promise<HostDocumentResponse>;
  }
  return window.desktopAgents?.managedDocument?.({ ...request, namespace: browserNamespace() }) ?? null;
}

export async function managedDocumentFile(key: ManagedFileKey, operation: ManagedFileOperation): Promise<ManagedFileState | null> {
  const response = await callHost({ ...key, ...operation });
  if (operation.op === 'read' && response && 'missing' in response) return null;
  if (response && (Array.isArray(response) || !('path' in response) || typeof response.path !== 'string' || typeof response.previewPath !== 'string'
    || !/^[\da-f]{64}$/.test(response.revision))) throw new Error('Invalid managed document response');
  return response;
}

export async function removeCanvasDocuments(canvasId: string) {
  const result = await callHost({ op: 'deleteCanvas', canvasId });
  if (result && !('removed' in result && result.removed)) throw new Error('Could not remove managed canvas files');
}

export async function probeManagedDocuments(items: ProbeItem[]): Promise<ManagedFileChange[]> {
  const changes: ManagedFileChange[] = [];
  for (let start = 0; start < items.length; start += 256) {
    const response = await callHost({ op: 'probe', items: items.slice(start, start + 256) });
    if (!response) return changes;
    if (!Array.isArray(response)) throw new Error('Invalid managed document probe');
    changes.push(...response);
  }
  return changes;
}
