import { get as idbGet, set as idbSet, del as idbDel, keys as idbKeys } from './disk-storage';
import type { Attachment, ThoughtNode } from '../types';
import { isNotebook } from './notebook';
import { DOCX_MIME_TYPE, isDocxDocument } from './document-copy';

// The attachment vault: bulky base64 payloads live in their own storage
// keys instead of inside node.data. PDF and DOCX originals live here — they
// never enter model context (only extractedText/editedText does). Keeping them
// out of the store shrinks the in-memory graph, every undo snapshot, and
// every persistence clone by the full weight of the PDFs.
//
// Images stay inline: their bytes ride the synchronous context-build path
// into vision requests, and they are typically an order of magnitude
// smaller than documents.
//
// Deleting a node does NOT delete its vault entries (undo must be able to
// resurrect them); orphans are swept by gcVault() at boot instead.

const KEY_PREFIX = 'att-content:';
const vaultKey = (attId: string) => `${KEY_PREFIX}${attId}`;
const REVISION_PREFIX = 'att-docx-revision:';
const revisionKey = (revision: string) => `${REVISION_PREFIX}${revision}`;

export type DocumentRevisionPatch = Pick<Attachment,
  'editedDocxRevision' | 'editedDocxContent' | 'editedDocxSavedAt'>;

function encodeBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** A saved DOCX is an immutable blob. History and duplicated attachments may
 * keep referring to an older revision, independently of their attachment ID. */
export async function saveDocumentRevision(att: Attachment, blob: Blob): Promise<DocumentRevisionPatch> {
  if (!isDocxDocument(att)) throw new Error('Native document revisions require a DOCX attachment.');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
    throw new Error('The editor did not return a DOCX archive.');
  }
  const editedDocxRevision = crypto.randomUUID();
  await idbSet(revisionKey(editedDocxRevision), encodeBytes(bytes));
  return { editedDocxRevision, editedDocxContent: undefined, editedDocxSavedAt: new Date().toISOString() };
}

// A notebook's raw JSON joins them: its base64 figures make it heavy, and
// only the reader's original view reads it (the model reads extractedText,
// the figures ride their own field).
const shouldVault = (att: Attachment): boolean =>
  (att.type === 'application/pdf' || att.type === DOCX_MIME_TYPE || isNotebook(att)) && !!att.content && !att.contentInVault;
const shouldVaultRevision = (att: Attachment): boolean => isDocxDocument(att) && att.editedDocxContent !== undefined;

/** Move a bulky payload into the vault; returns the lightened attachment.
    Other (and already-vaulted) attachments pass through unchanged. */
export async function internAttachment(att: Attachment): Promise<Attachment> {
  let next = att;
  if (shouldVault(att)) {
    await idbSet(vaultKey(att.id), att.content);
    next = { ...next, content: '', contentInVault: true };
  }
  if (shouldVaultRevision(att)) {
    // An imported canvas must not rewrite a different revision already used
    // by another canvas or its undo history, even if its IDs collide.
    let revision = att.editedDocxRevision || crypto.randomUUID();
    const existing = await idbGet<string>(revisionKey(revision));
    if (existing !== undefined && existing !== att.editedDocxContent) revision = crypto.randomUUID();
    await idbSet(revisionKey(revision), att.editedDocxContent);
    next = { ...next, editedDocxRevision: revision };
    delete next.editedDocxContent;
  }
  return next;
}

/** The attachment's payload, wherever it lives. '' when the vault entry is
    missing (cleared storage) — callers surface their own error state. */
export async function loadAttachmentContent(att: Attachment): Promise<string> {
  if (!att.contentInVault) return att.content;
  return (await idbGet<string>(vaultKey(att.id))) ?? '';
}

/** Read the latest explicitly saved DOCX. A missing revision must surface as
 * missing, never silently reopen the original and hide the user's edits.
 * Legacy HTML copies deliberately do not overwrite the native source. */
export async function loadDocumentContent(att: Attachment): Promise<string> {
  if (att.editedDocxContent !== undefined) return att.editedDocxContent;
  if (att.editedDocxRevision) return (await idbGet<string>(revisionKey(att.editedDocxRevision))) ?? '';
  return loadAttachmentContent(att);
}

/** Exports and backups carry the FULL payload: a .thoughtdag.json must stay
    a complete, self-contained copy of the canvas. */
export async function inlineVaultedContent(nodes: ThoughtNode[]): Promise<ThoughtNode[]> {
  const out: ThoughtNode[] = [];
  for (const n of nodes) {
    const atts = n.data.attachments;
    if (!atts?.some((a) => a.contentInVault || a.editedDocxRevision)) { out.push(n); continue; }
    const inlined: Attachment[] = [];
    for (const a of atts) {
      const rest = { ...a };
      if (a.contentInVault) {
        rest.content = await loadAttachmentContent(a);
        delete rest.contentInVault;
      }
      if (a.editedDocxRevision && a.editedDocxContent === undefined) {
        const content = await loadDocumentContent(a);
        if (!content) throw new Error(`Saved DOCX revision is missing: ${a.name}`);
        rest.editedDocxContent = content;
      }
      inlined.push(rest);
    }
    out.push({ ...n, data: { ...n.data, attachments: inlined } });
  }
  return out;
}

/** Imports strip bulky payloads back INTO the vault before the graph is
    stored; returns the lightened nodes. */
export async function internNodes(nodes: ThoughtNode[]): Promise<ThoughtNode[]> {
  const out: ThoughtNode[] = [];
  for (const n of nodes) {
    const atts = n.data.attachments;
    if (!atts?.some((a) => shouldVault(a) || shouldVaultRevision(a))) { out.push(n); continue; }
    const interned: Attachment[] = [];
    for (const a of atts) interned.push(await internAttachment(a));
    out.push({ ...n, data: { ...n.data, attachments: interned } });
  }
  return out;
}

/** Sweep vault entries no canvas references anymore. `referencedIds` must
 * cover EVERY project's attachments. Native revisions are retained unless the
 * caller supplies a complete revision set, including retained undo snapshots;
 * a copied attachment can reference a revision owned by a different ID. */
export async function gcVault(referencedIds: Set<string>, referencedDocxRevisions?: ReadonlySet<string>): Promise<number> {
  const all = (await idbKeys()) as string[];
  let swept = 0;
  for (const k of all) {
    if (typeof k !== 'string') continue;
    if (k.startsWith(REVISION_PREFIX)) {
      if (!referencedDocxRevisions || referencedDocxRevisions.has(k.slice(REVISION_PREFIX.length))) continue;
    } else if (k.startsWith(KEY_PREFIX)) {
      if (referencedIds.has(k.slice(KEY_PREFIX.length))) continue;
    } else continue;
    await idbDel(k);
    swept++;
  }
  return swept;
}
