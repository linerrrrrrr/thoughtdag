import type { ThoughtNode, ThoughtEdge } from '../types';
import { isNotebook } from './notebook';
import { DOCX_MIME_TYPE } from './document-copy';
import { normalizeConversationGraph } from './normalize-graph';
import { splitLegacyFileNodes } from './single-file-nodes';

// Legacy local read-only viewer: graph data travels in the URL hash
// (#view=<deflate+base64url>). Remote deployments do not open these links.
// The local viewer is the same app with every write path closed:
// persistence is a no-op (a visitor's clicks can't overwrite their own
// canvases), generation actions early-return, and the mutating UI hides.

export function isLocalViewerOrigin(location: Pick<Location, 'protocol' | 'hostname'>): boolean {
  return location.protocol === 'file:' || ['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname);
}

export const isViewerMode =
  typeof window !== 'undefined' && window.location.hash.startsWith('#view=');
export const isViewerUnavailable = isViewerMode && !isLocalViewerOrigin(window.location);

const b64url = {
  encode(bytes: Uint8Array): string {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(s: string): Uint8Array {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  },
};

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export interface ViewerPayload {
  nodes: ThoughtNode[];
  edges: ThoughtEdge[];
}

/** Build a local viewer URL for legacy compatibility and viewer fixtures. */
export async function buildViewerLink(nodes: ThoughtNode[], edges: ThoughtEdge[]): Promise<string> {
  if (!isLocalViewerOrigin(window.location)) throw new Error('Read-only viewer links are only available locally.');
  const clean: ViewerPayload = {
    nodes: nodes.map((n) => ({
      ...n,
      selected: false,
      data: {
        ...n.data,
        isLoading: false, isEditing: false, isEditingResponse: false, reasoning: undefined,
        codexVisuals: undefined,
        // Heavy asset bytes stay home: original PDF bytes, rendered page
        // images, a notebook's JSON and figures, and full-size image
        // originals would blow the URL past what address bars and share
        // intents carry (and sharing a paper's file is not ours to do).
        // Extracted text, digests and thumbnails may still travel.
        attachments: (n.data.attachments ?? []).map((a) => ({
          ...a,
          nodeFileRevision: undefined,
          pdfFileRevision: undefined,
          pdfFileContent: undefined,
          pdfSavedAnnotations: undefined,
          content: a.type.startsWith('image/') || a.type === 'application/pdf' || a.type === DOCX_MIME_TYPE || isNotebook(a) ? '' : a.content,
          contentInVault: undefined,
          editedDocxContent: undefined,
          editedDocxRevision: undefined,
          legacyDocumentHtml: undefined,
          legacyDocumentText: undefined,
          pageImages: undefined,
          figures: undefined,
          isExtracting: false,
        })),
      },
    })),
    edges: edges.map((e) => (e.selected ? { ...e, selected: false } : e)),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(normalizeConversationGraph(clean)));
  const packed = await pipe(bytes, new CompressionStream('deflate-raw'));
  const url = new URL(window.location.href);
  url.hash = `view=${b64url.encode(packed)}`;
  return url.href;
}

export async function decodeViewerHash(hash: string): Promise<ViewerPayload> {
  const packed = b64url.decode(hash.replace(/^#view=/, ''));
  const bytes = await pipe(packed, new DecompressionStream('deflate-raw'));
  return splitLegacyFileNodes(normalizeConversationGraph(JSON.parse(new TextDecoder().decode(bytes)) as ViewerPayload));
}

/** Boot path for viewer mode: silence persistence, then load the graph from
    the hash straight into the in-memory store. Replaces bootProjects(). */
export async function bootViewer(): Promise<void> {
  if (isViewerUnavailable) return;
  // (persistence is already a no-op: store/index.ts picks the storage by
  // isViewerMode at creation time, so no early set() can race this boot)
  const { useStore } = await import('../store');
  try {
    const { nodes, edges } = await decodeViewerHash(window.location.hash);
    useStore.setState({
      nodes,
      edges,
      history: [{ nodes, edges }],
      historyIndex: 0,
      selectedNodeId: null,
      selectedNodeIds: [],
    });
  } catch (err) {
    console.error('[thoughtdag] viewer link decode failed:', err);
    const { useUiStore } = await import('./ui-store');
    useUiStore.getState().setViewerLoadError(true);
  }
}
