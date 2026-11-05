// Verify synchronization detects real drift and preserves unrelated document text.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { expectedTokens, scalarEntries, synchronizeDesign } from './check-design-system.mjs';

const [css, conversation, design] = await Promise.all([
  readFile(new URL('../src/index.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/ConversationSurface.css', import.meta.url), 'utf8'),
  readFile(new URL('../DESIGN.md', import.meta.url), 'utf8'),
]);
const expected = expectedTokens(css, conversation);
const baseline = synchronizeDesign(design, expected);
assert.ok(baseline.checked > 50, 'The check covers the documented shared token families');
assert.equal(baseline.changes.length, 0, 'The current contract matches the runtime baseline');

const changedCss = css.replace('--text-body: 1rem;', '--text-body: 1.125rem;');
assert.notEqual(changedCss, css, 'The fixture mutates the owning body token');
const bodyChange = synchronizeDesign(design, expectedTokens(changedCss, conversation));
assert.ok(bodyChange.changes.some(change => change.path === 'typography.body.fontSize' && change.runtime === '1.125rem'));
assert.ok(!bodyChange.changes.some(change => change.path === 'typography.control.fontSize'), 'A body change does not rewrite controls');
assert.equal(synchronizeDesign(bodyChange.markdown, expectedTokens(changedCss, conversation)).changes.length, 0, 'Synchronization is idempotent');
assert.equal(bodyChange.markdown.split(/\r?\n---\r?\n/)[1], design.split(/\r?\n---\r?\n/)[1], 'All prose survives synchronization');

const darkChange = expectedTokens(css.replace('--color-card: #222833;', '--color-card: #232934;'), conversation);
assert.equal(darkChange.get('colors.dark-conversation-surface'), '#232934', 'Scoped aliases follow dark theme overrides');
assert.equal(darkChange.get('colors.conversation-surface'), expected.get('colors.conversation-surface'), 'Light values stay separate');
assert.equal(expected.get('rounded.toolbar'), '15px', 'Nested corner geometry resolves token references and the border');
assert.equal(expected.get('rounded.conversation-inner'), '13px', 'Inner geometry subtracts the border');

assert.throws(() => expectedTokens(css.replace('--text-body: 1rem;', '--text-body: var(--missing-body);'), conversation), /Undefined design token/);
assert.throws(() => expectedTokens(css.replace('--text-body: 1rem;', '--text-body: var(--text-body);'), conversation), /Circular design token/);
assert.throws(() => synchronizeDesign('---\nname: Example\n---\n', expected), /Document the core roles/);
assert.throws(() => scalarEntries('---\nname: Example'), /not closed/);

const extra = design.replace('\ncomponents:', '\ncustom-note: "Do not change this"\ncomponents:');
assert.ok(synchronizeDesign(extra, expected).markdown.includes('custom-note: "Do not change this"'), 'Unmapped fields are preserved');
console.log(`PASS design synchronization: ${baseline.checked} mapped values, isolated type/theme mutations, geometry, idempotence, preserved prose, and invalid references.`);
