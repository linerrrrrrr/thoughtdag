// Synchronize the documented core tokens with their runtime CSS definitions.
// This intentionally checks mapped primitives, not every component or visual state.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stripComments = value => value.replace(/\/\*[\s\S]*?\*\//g, '');

function declarations(block) {
  return Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)]
    .map(([, key, value]) => [key, value.trim()]));
}

function variables(css, dark) {
  const text = stripComments(css);
  const result = {};
  const pattern = dark
    ? /:root\[data-theme=['"]dark['"]\]\s*\{([^{}]*)\}/g
    : /(?:@theme|:root)\s*\{([^{}]*)\}/g;
  for (const match of text.matchAll(pattern)) Object.assign(result, declarations(match[1]));
  return result;
}

function resolveValue(value, tokens, chain = []) {
  let result = value.replace(/var\((--[\w-]+)\)/g, (_, name) => {
    if (!(name in tokens)) throw new Error(`Undefined design token: ${name}`);
    if (chain.includes(name)) throw new Error(`Circular design token: ${[...chain, name].join(' -> ')}`);
    return resolveValue(tokens[name], tokens, [...chain, name]);
  });
  // Evaluate only additive pixel geometry; do not evaluate arbitrary CSS as code.
  if (/^calc\(\s*\d+(?:\.\d+)?px(?:\s*[+-]\s*\d+(?:\.\d+)?px)+\s*\)$/.test(result)) {
    const terms = result.slice(5, -1).replace(/\s/g, '').match(/[+-]?\d+(?:\.\d+)?px/g);
    result = `${terms.reduce((total, term) => total + Number.parseFloat(term), 0)}px`;
  }
  return result;
}

// DESIGN.md uses a deliberately small nested scalar subset of YAML. Preserve its
// formatting and all unmapped content instead of parsing and rewriting the file.
export function scalarEntries(markdown) {
  const lines = markdown.split('\n');
  if (lines[0].trim() !== '---') throw new Error('DESIGN.md requires YAML frontmatter.');
  const entries = [];
  const parents = [];
  let closed = false;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '---') { closed = true; break; }
    const match = /^( *)([\w-]+):(?:\s+(.*?))?\r?$/.exec(lines[index]);
    if (!match) continue;
    const depth = match[1].length / 2;
    if (!Number.isInteger(depth)) throw new Error(`Unsupported frontmatter indent on line ${index + 1}`);
    parents.length = depth;
    const path = [...parents, match[2]].join('.');
    if (!match[3]) { parents.push(match[2]); continue; }
    const raw = match[3].trim();
    const value = raw.startsWith('"') ? JSON.parse(raw) : raw.replace(/^'|'$/g, '');
    entries.push({ path, value: String(value), index, prefix: `${match[1]}${match[2]}: ` });
  }
  if (!closed) throw new Error('DESIGN.md frontmatter is not closed.');
  return { entries, lines };
}

export function expectedTokens(globalCss, conversationCss) {
  const base = { ...variables(globalCss, false), ...variables(conversationCss, false) };
  const dark = { ...base, ...variables(globalCss, true), ...variables(conversationCss, true) };
  const expected = new Map();
  const token = (name, theme = base) => {
    if (!(name in theme)) throw new Error(`Missing core design token: ${name}`);
    return resolveValue(theme[name], theme, [name]);
  };
  const roles = {
    meta: 'meta', control: 'control', body: 'body', title: 'title',
    heading: 'heading', section: 'section', page: 'page',
    label: 'control', caption: 'meta', 'node-meta': 'meta',
    'overview-name': 'title', 'conversation-user': 'body', 'conversation-answer': 'body',
    'focus-user': 'body', 'conversation-caption': 'meta', 'conversation-caption-narrow': 'meta',
    'metadata-title': 'title', 'metadata-summary': 'body', 'summary-name': 'title',
    'summary-preview': 'control', 'focus-panel-title': 'title',
  };
  for (const [name, role] of Object.entries(roles)) {
    expected.set(`typography.${name}.fontSize`, token(`--text-${role}`));
    expected.set(`typography.${name}.lineHeight`, token(`--text-${role}--line-height`));
  }
  expected.set('typography.body.fontFamily', token('--font-sans'));
  expected.set('typography.mono.fontFamily', token('--font-mono'));
  for (const role of ['port', 'tag', 'control', 'content', 'node', 'overlay', 'panel', 'toolbar']) {
    expected.set(`rounded.${role}`, token(`--radius-${role}`));
  }
  expected.set('rounded.conversation', token('--radius-node'));
  expected.set('rounded.conversation-inner', resolveValue('calc(var(--radius-node) - 1px)', base));
  expected.set('rounded.conversation-code', token('--radius-content'));
  expected.set('rounded.conversation-bubble-corner', token('--radius-tag'));
  expected.set('rounded.conversation-bubble', ['content', 'content', 'tag', 'content'].map(role => token(`--radius-${role}`)).join(' '));
  for (const role of ['canvas-inset', 'surface-inset', 'toolbar-inset', 'control-gap', 'section-gap', 'related', 'control-size']) {
    expected.set(`spacing.${role}`, token(`--spacing-${role}`));
  }
  for (const [name, value] of Object.entries(base)) {
    if (/^--(?:color-|conversation-)/.test(name)) {
      const key = name.replace(/^--color-/, '').replace(/^--/, '');
      expected.set(`colors.${key}`, resolveValue(value, base, [name]));
      expected.set(`colors.dark-${key}`, token(name, dark));
    }
  }
  return expected;
}

export function synchronizeDesign(markdown, expected) {
  const { entries, lines } = scalarEntries(markdown);
  const present = new Set(entries.map(entry => entry.path));
  const required = ['body', 'control', 'meta', 'title', 'heading', 'section', 'page']
    .flatMap(role => [`typography.${role}.fontSize`, `typography.${role}.lineHeight`]);
  required.push('rounded.node', 'rounded.panel', 'rounded.toolbar', 'spacing.surface-inset');
  const missing = required.filter(path => !present.has(path));
  if (missing.length) throw new Error(`Document the core roles in DESIGN.md before syncing: ${missing.join(', ')}`);
  const changes = [];
  let checked = 0;
  for (const entry of entries) {
    if (!expected.has(entry.path)) continue;
    checked += 1;
    const value = expected.get(entry.path);
    if (entry.value.toLowerCase() === value.toLowerCase()) continue;
    changes.push({ path: entry.path, documented: entry.value, runtime: value });
    const numeric = entry.path.endsWith('.lineHeight');
    lines[entry.index] = `${entry.prefix}${numeric ? value : JSON.stringify(value)}${lines[entry.index].endsWith('\r') ? '\r' : ''}`;
  }
  return { checked, changes, markdown: lines.join('\n') };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--write')) throw new Error('Usage: node scripts/check-design-system.mjs [--write]');
  const [globalCss, conversationCss, markdown] = await Promise.all([
    readFile(resolve(repoRoot, 'src/index.css'), 'utf8'),
    readFile(resolve(repoRoot, 'src/components/ConversationSurface.css'), 'utf8'),
    readFile(resolve(repoRoot, 'DESIGN.md'), 'utf8'),
  ]);
  const result = synchronizeDesign(markdown, expectedTokens(globalCss, conversationCss));
  if (!result.changes.length) {
    console.log(`PASS ${result.checked} documented core tokens match runtime CSS. Component composition and rendered UI require separate checks.`);
    return;
  }
  for (const change of result.changes) console.log(`${change.path}: ${change.documented} -> ${change.runtime}`);
  if (!args.includes('--write')) {
    console.error(`FAIL ${result.changes.length} token snapshots differ. Review the CSS change, then run with --write to synchronize DESIGN.md.`);
    process.exitCode = 1;
    return;
  }
  // Avoid overwriting another task's edits made while the inputs were loading.
  if (await readFile(resolve(repoRoot, 'DESIGN.md'), 'utf8') !== markdown) throw new Error('DESIGN.md changed during the check; retry with the current file.');
  await writeFile(resolve(repoRoot, 'DESIGN.md'), result.markdown);
  console.log(`Updated ${result.changes.length} mapped snapshots; prose and unmapped component recipes were preserved.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
