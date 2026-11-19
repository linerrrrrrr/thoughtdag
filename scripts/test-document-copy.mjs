// Document working copies keep originals intact and drive every model read.
// Run: node scripts/test-document-copy.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(join(tmpdir(), 'tdag-document-copy-'));
const outfile = join(temporary, 'documents.mjs');
const stubs = {
  'idb-keyval': 'const db = new Map(); export const get = async k => db.get(k); export const set = async (k, v) => { db.set(k, v); }; export const del = async k => { db.delete(k); }; export const keys = async () => [...db.keys()];',
  'condense-guard': 'export const condenseGuard = () => false;',
  'ui-store': 'export const toast = () => "";',
  i18n: 'export const t = k => k; export const fmt = s => s;',
};
try {
  await build({
    stdin: {
      contents: `
        export * from './lib/document-copy';
        export * from './lib/attachment-vault';
        export { attachmentContextKey } from './lib/attachment-fingerprint';
        export { buildContext } from './store/context-builder';
        export { compileContextBundle, graphSnapshotHash } from './lib/context-bundle';
        import { create } from 'zustand';
        import { createHistorySlice } from './store/slices/history';
        export const makeStore = () => create((set, get, api) => ({
          ...createHistorySlice(set, get, api), nodes: [], edges: [], events: [], logEvent: () => {},
        }));`,
      resolveDir: join(root, 'src'), loader: 'ts',
    },
    bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent',
    define: { 'import.meta.env.VITE_API_BASE': '""', 'import.meta.env.DEV': 'false' },
    plugins: [{ name: 'browser-boundaries', setup(builder) {
      builder.onResolve({ filter: /(?:^idb-keyval$|\/(?:condense-guard|ui-store|i18n)$)/ }, args => ({ path: args.path.split('/').pop(), namespace: 'stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path], loader: 'js' }));
    } }],
  });
  const { DOCX_MIME_TYPE, isEditableDocument, hasNativeDocxSource, documentCopyText, internAttachment, loadAttachmentContent,
    loadDocumentContent, saveDocumentRevision, savePdfFileRevision, loadNodePdfFile, attachmentContextKey, gcVault,
    inlineVaultedContent, internNodes, buildContext, compileContextBundle, graphSnapshotHash, makeStore } = await import(pathToFileURL(outfile).href);
  const pdf = { id: 'pdf', name: 'original.pdf', type: 'application/pdf', size: 100, content: 'PDF_BINARY_BYTES', extractedText: 'source PDF text' };
  const docx = { id: 'docx', name: 'original.docx', type: DOCX_MIME_TYPE, size: 120, content: 'DOCX_BINARY_BYTES', extractedText: '# Source title\n\nsource DOCX text' };
  const legacy = { id: 'legacy', name: 'old.DOCX', type: 'text/plain', size: 90, content: 'legacy DOCX text' };
  const node = (id, attachments = [], stepKind) => ({ id, type: 'thought', position: { x: 0, y: 0 }, data: {
    stepKind, question: id === 'ask' ? 'Read the materials' : '', response: '', responses: [], responseIndex: -1,
    isCollapsed: false, isEditing: false, isLoading: false, tokenCount: 0, highlights: [], highlightMode: 'off', attachments,
  } });
  const edge = { id: 'material-to-ask', source: 'material', target: 'ask', type: 'smoothstep', data: {} };
  const graph = atts => [node('material', atts, 'file'), node('ask')];
  assert.ok([pdf, docx, legacy].every(isEditableDocument));
  assert.equal(isEditableDocument({ ...legacy, name: 'notes.txt' }), false);
  assert.equal(documentCopyText(legacy), 'legacy DOCX text');
  assert.equal(documentCopyText({ ...docx, extractedText: undefined }), '');
  assert.equal(documentCopyText({ ...pdf, editedText: '' }), '');
  console.log('PASS document kinds, legacy copies, and empty-copy precedence');

  const revised = [ { ...pdf, editedText: 'revised PDF text' }, { ...docx, editedText: 'revised DOCX text' }, { ...legacy, editedText: '' } ];
  const nodes = graph(revised);
  const compiled = buildContext('ask', nodes, [edge]);
  const text = compiled.messages.map(message => message.content).join('\n');
  assert.ok(text.includes('revised PDF text') && text.includes('revised DOCX text'));
  assert.ok(!text.includes('BINARY_BYTES') && !text.includes('source PDF text') && !text.includes('source DOCX text') && !text.includes('legacy DOCX text'));
  assert.ok(text.includes('[File: old.DOCX]'));
  assert.equal(compiled.images.length, 0);
  const missingText = buildContext('ask', graph([{ ...docx, extractedText: undefined }]), [edge]).messages.map(message => message.content).join('\n');
  assert.ok(!missingText.includes('DOCX_BINARY_BYTES'));
  console.log('PASS downstream context uses saved copies and never DOCX/PDF binary');

  const sameSourceNodes = [node('copy-one', [{ ...docx, id: 'copy-one', editedText: 'First interpretation' }], 'file'),
    node('copy-two', [{ ...docx, id: 'copy-two', editedText: 'Second interpretation' }], 'file'), node('ask')];
  const copyEdges = ['copy-one', 'copy-two'].map(source => ({ ...edge, id: `${source}-ask`, source }));
  const copyMessages = buildContext('ask', sameSourceNodes, copyEdges).messages.map(message => message.content).join('\n');
  assert.ok(copyMessages.includes('First interpretation') && copyMessages.includes('Second interpretation'));
  console.log('PASS different working copies of the same original both enter context');

  const bundle = await compileContextBundle('ask', nodes, [edge], { now: '2026-11-11T00:00:00Z' });
  assert.equal(bundle.context.materials.length, 3);
  assert.ok(bundle.context.materials.every(material => material.model_projection.mode === 'extracted_text'));
  assert.notEqual(await graphSnapshotHash(graph([pdf]), [edge]), await graphSnapshotHash(graph([{ ...pdf, editedText: '' }]), [edge]));
  console.log('PASS bundle projection and semantic hash include saved empty copies');
  const richOne = { ...docx, editedText: 'Visible text', editedHtml: '<p>Visible text</p><img src="data:image/png;base64,first-image">' };
  const richTwo = { ...richOne, editedHtml: '<p>Visible text</p><img src="data:image/png;base64,second-image">' };
  assert.notEqual(await graphSnapshotHash(graph([richOne]), [edge]), await graphSnapshotHash(graph([richTwo]), [edge]));
  const annotatedPdf = { ...pdf, pdfAnnotations: [{ id:'mark', page:1, rects:[[0, 0, .2, .1]], comment:'Private margin note', color:'#ffff00', createdAt:'2026-11-11T00:00:00Z' }] };
  const richContext = buildContext('ask', graph([richOne, annotatedPdf]), [edge]).messages.map(message => message.content).join('\n');
  assert.ok(richContext.includes('Visible text') && !richContext.includes('base64') && !richContext.includes('first-image'));
  assert.ok(!richContext.includes('Private margin note'));
  console.log('PASS rich image edits change revision while image bytes and PDF annotations stay out of model text');

  const light = await internAttachment(docx);
  assert.equal(light.content, '');
  assert.equal(light.contentInVault, true);
  assert.equal(await loadAttachmentContent(light), docx.content);
  const backedUp = await inlineVaultedContent(graph([{ ...light, editedText: '' }]));
  const exported = backedUp[0].data.attachments[0];
  assert.equal(exported.content, docx.content);
  assert.equal(exported.editedText, '');
  assert.equal(exported.extractedText, docx.extractedText);
  assert.equal(exported.contentInVault, undefined);
  const imported = await internNodes(backedUp);
  assert.equal(await loadAttachmentContent(imported[0].data.attachments[0]), docx.content);
  assert.equal(imported[0].data.attachments[0].editedText, '');
  assert.equal((await internAttachment(legacy)).content, legacy.content);
  console.log('PASS originals and saved copies survive vault/backup/import round trip');

  assert.ok(hasNativeDocxSource(docx) && hasNativeDocxSource(light));
  assert.equal(hasNativeDocxSource(legacy), false);
  assert.equal(await loadDocumentContent({ ...light, editedHtml: '<p>legacy copy</p>' }), docx.content);
  const revisionOne = await saveDocumentRevision(light, new Blob([new Uint8Array([80, 75, 3, 4, 1, 2, 3])]));
  const revisionTwo = await saveDocumentRevision(light, new Blob([new Uint8Array([80, 75, 3, 4, 4, 5, 6])]));
  const savedOne = { ...light, ...revisionOne, editedText: 'Saved text' };
  const savedTwo = { ...light, ...revisionTwo, editedText: 'Saved text' };
  assert.notEqual(revisionOne.editedDocxRevision, revisionTwo.editedDocxRevision);
  assert.equal(revisionOne.editedDocxContent, undefined);
  assert.equal(await loadAttachmentContent(savedTwo), docx.content);
  const firstBytes = await loadDocumentContent(savedOne);
  const secondBytes = await loadDocumentContent(savedTwo);
  assert.notEqual(firstBytes, secondBytes);
  assert.equal(await loadDocumentContent({ ...savedOne, id: 'copied-attachment' }), firstBytes);
  assert.equal(await loadDocumentContent({ ...savedOne, editedDocxRevision: 'missing-revision' }), '');
  assert.notEqual(attachmentContextKey(savedOne), attachmentContextKey(savedTwo));
  await assert.rejects(() => saveDocumentRevision(light, new Blob(['not a DOCX'])));
  await assert.rejects(() => saveDocumentRevision(pdf, new Blob([new Uint8Array([80, 75, 3, 4])])));
  console.log('PASS native DOCX saves are immutable, independent of attachment IDs, and leave the original intact');

  const nativeBackup = await inlineVaultedContent(graph([savedOne]));
  const nativeExport = nativeBackup[0].data.attachments[0];
  assert.equal(nativeExport.content, docx.content);
  assert.equal(nativeExport.editedDocxContent, firstBytes);
  assert.equal(nativeExport.editedDocxRevision, savedOne.editedDocxRevision);
  const nativeImported = (await internNodes(nativeBackup))[0].data.attachments[0];
  assert.equal(nativeImported.editedDocxContent, undefined);
  assert.equal(await loadDocumentContent(nativeImported), firstBytes);
  const collidingImport = await internAttachment({ ...nativeExport, editedDocxContent: secondBytes });
  assert.notEqual(collidingImport.editedDocxRevision, nativeExport.editedDocxRevision);
  assert.equal(await loadDocumentContent(savedOne), firstBytes);
  assert.equal(await loadDocumentContent(collidingImport), secondBytes);
  const revisionOnlyExport = (await inlineVaultedContent(graph([{ ...docx, ...revisionOne }])))[0].data.attachments[0];
  assert.equal(revisionOnlyExport.editedDocxContent, firstBytes);
  await assert.rejects(() => inlineVaultedContent(graph([{ ...savedOne, editedDocxRevision: 'missing-revision' }])));
  console.log('PASS native DOCX backup/import is self-contained and ID collisions cannot rewrite another revision');

  const store = makeStore();
  const originalNodes = graph([pdf]);
  store.setState({ nodes: originalNodes, edges: [edge], history: [{ nodes: originalNodes, edges: [edge] }], historyIndex: 0 });
  store.getState().pushHistory();
  store.setState({ nodes: graph([{ ...pdf, editedText: '' }]) });
  store.getState().pushHistory();
  store.getState().undo();
  let attachment = store.getState().nodes[0].data.attachments[0];
  assert.equal(attachment.editedText, undefined);
  assert.equal(attachment.extractedText, pdf.extractedText);
  assert.equal(attachment.content, pdf.content);
  store.getState().redo();
  attachment = store.getState().nodes[0].data.attachments[0];
  assert.equal(attachment.editedText, '');
  assert.equal(attachment.extractedText, pdf.extractedText);
  assert.equal(attachment.content, pdf.content);
  console.log('PASS one-step undo/redo restores working copy without changing source');

  const nativeStore = makeStore();
  const nativeOriginalNodes = graph([savedOne]);
  nativeStore.setState({ nodes: nativeOriginalNodes, edges: [edge], history: [{ nodes: nativeOriginalNodes, edges: [edge] }], historyIndex: 0 });
  nativeStore.getState().pushHistory();
  nativeStore.setState({ nodes: graph([savedTwo]) });
  nativeStore.getState().pushHistory();
  nativeStore.getState().undo();
  assert.equal(await loadDocumentContent(nativeStore.getState().nodes[0].data.attachments[0]), firstBytes);
  nativeStore.getState().redo();
  assert.equal(await loadDocumentContent(nativeStore.getState().nodes[0].data.attachments[0]), secondBytes);
  assert.equal(nativeStore.getState().nodes[0].data.attachments[0].editedDocxContent, undefined);
  await gcVault(new Set(['docx']));
  assert.equal(await loadDocumentContent(savedOne), firstBytes);
  await gcVault(new Set(['docx']), new Set([revisionOne.editedDocxRevision]));
  assert.equal(await loadDocumentContent(savedOne), firstBytes);
  assert.equal(await loadDocumentContent(savedTwo), '');
  console.log('PASS native DOCX undo/redo keeps revision bytes out of graph history and conservative GC preserves them');

  const updatedPdf = { ...pdf, pdfFileRevision: await savePdfFileRevision('UPDATED_PDF_BYTES') };
  const [pdfBackup] = await inlineVaultedContent(graph([updatedPdf]));
  assert.equal(pdfBackup.data.attachments[0].pdfFileContent, 'UPDATED_PDF_BYTES');
  const [pdfImport] = await internNodes([pdfBackup]);
  assert.equal(pdfImport.data.attachments[0].pdfFileContent, undefined);
  assert.equal(await loadNodePdfFile(pdfImport.data.attachments[0]), 'UPDATED_PDF_BYTES');
  assert.equal(await loadAttachmentContent(updatedPdf), pdf.content);
  console.log('PASS PDF revisions survive portable backup and keep the import snapshot independent');
} finally {
  assert.ok(resolve(temporary).startsWith(`${resolve(tmpdir())}${sep}`));
  rmSync(temporary, { recursive: true, force: true });
}
