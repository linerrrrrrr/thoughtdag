import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({
  stdin: { resolveDir: process.cwd(), contents: `
    export { createDocxHighlightIndex } from './src/lib/docx-live-highlights.ts';
    export { draftDocxHighlights, subscribeDocxHighlights } from './src/lib/docx-highlight-drafts.ts';
  ` },
  bundle: true, platform: 'node', format: 'esm', loader: { '.css': 'text' }, write: false,
});
const { createDocxHighlightIndex, draftDocxHighlights, subscribeDocxHighlights } =
  await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].contents).toString('base64'));

const color = '#ffcf40';
const segment = (blockId, start, end) => ({ blockId, range: { start, end } });
const textRun = (text, start, marked) => ({ text, range: { start, end: start + text.length }, styles: { highlight: marked ? color : undefined } });
const block = (id, ...runs) => ({ matchKind: 'text', blocks: [{ blockId: id, runs }] });
const a = segment('p1', 0, 4), b = segment('p1', 4, 8), c = segment('p2', 0, 4);
let file = { id: 'document', documentHighlights: [] };
let items = [], version = 0, dirty = false, reads = 0, changed;
const instance = {
  ui: { document: {
    getVersion: () => String(version), getSnapshot: () => ({ dirty }),
    onChange: listener => { changed = listener; return () => { changed = undefined; }; },
  } },
  activeEditor: { doc: { query: { match: async () => { reads++; return { items, total: items.length }; } } } },
};
let index = createDocxHighlightIndex(instance, file);
let publications = 0;
const stop = subscribeDocxHighlights(() => publications++);
const marks = () => draftDocxHighlights(file);
const mutate = next => { items = next; dirty = true; version++; changed(); };
const stroke = (...segments) => index.stroke({ target: { segments } });
await index.flush();
assert.equal(reads, 0, 'A clean unmarked file opens without a document-wide scan');

mutate([block('p1', textRun('same', 0, true), textRun('same', 4, false)), block('p2', textRun('same', 0, false))]);
stroke(a);
await index.flush();
const first = marks()[0];
assert.equal(first.text, 'same');
assert.equal(first.strokeId, undefined);

const adjacent = [block('p1', textRun('samesame', 0, true)), block('p2', textRun('same', 0, true))];
mutate(adjacent);
stroke(b, c);
await index.flush();
const [one, two, three] = marks();
assert.equal(one.id, first.id);
assert.ok(two.strokeId && two.strokeId === three.strokeId);
assert.equal(new Set([one.id, two.id, three.id]).size, 3);
const identity = list => list.map(mark => [mark.id, mark.strokeId, mark.anchor]);
const expected = identity(marks());
const updates = publications;
mutate(adjacent);
await index.flush();
assert.equal(publications, updates, 'Stable geometry does not notify the canvas for unrelated edits');

mutate([block('p1', textRun('same', 0, true), textRun('same', 4, false)), block('p2', textRun('same', 0, false))]);
await index.flush();
assert.deepEqual(identity(marks()), identity([first]));
mutate(adjacent);
await index.flush();
assert.deepEqual(identity(marks()), expected, 'Redo restores both physical endpoints and their stroke');

mutate([block('p1', textRun('Prefix ', 0, false), textRun('samesame', 7, true)), adjacent[1]]);
await index.flush();
assert.deepEqual(marks().map(mark => [mark.id, mark.anchor.start]), [[one.id, 7], [two.id, 11], [three.id, 0]]);

const saved = marks();
const committed = { ...file, documentHighlights: saved };
index.saved(committed);
assert.equal(marks(), undefined);
index.dispose();
file = committed;
dirty = false;
index = createDocxHighlightIndex(instance, file);
const reopened = await index.flush();
assert.deepEqual(identity(reopened), identity(saved));
assert.equal(marks(), undefined, 'A clean reopened file reads its saved metadata');
mutate([block('p1', textRun('Prefix samesame', 0, false)), block('p2', textRun('same', 0, false))]);
await index.flush();
assert.deepEqual(marks(), [], 'Removing every mark overrides the saved nonempty index');
dirty = false;
index.clean();
assert.equal(marks(), undefined, 'Undo back to the saved baseline clears the overlay');
index.dispose();
stop();
console.log('PASS DOCX live highlight identities, adjacent same-color strokes, cross-paragraph grouping, undo/redo, save/reopen and quiet snapshots');
