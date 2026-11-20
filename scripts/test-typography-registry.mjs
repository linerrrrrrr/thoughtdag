import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkTypography } from './check-typography.mjs';

// Build the fixture like an application. No project file or real user data
// is modified, and the production checker runs unchanged on each mutation.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thoughtdag-type-registry-'));
function write(name, contents) {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}
function remove(name) { fs.unlinkSync(path.join(root, name)); }
const owner = 'src/Card.tsx';
const dock = 'src/Dock.tsx';
const registryFile = 'src/design-system/typography-registry.json';
const sheet = 'src/design-system/typography-surfaces.css';
const manifest = {
  roles: ['control', 'body'],
  modules: { [owner]: ['Card'], [dock]: ['Dock'] },
  boundaries: { [owner]: { '.bounds': 'canvas-geometry' }, [dock]: { '.dock': 'node-input' }, 'sample.html': {body: 'screen'} },
};
const app = `import Dock from './Dock';
export function Card() {return <main className="bounds" data-type-surface="canvas-geometry"><Dock/></main>;}`;
const content = `export default function Dock() {return <aside className="dock" data-type-surface="node-input"><span>source</span></aside>;}`;
const css = `[data-type-surface="canvas-geometry"] { --overview-zoom: 1; }
[data-type-surface="node-input"] {zoom:var(--canvas-conversation-scale);}
[data-type-surface="screen"] {zoom:var(--ui-scale);}
[data-type-surface="portal"] {zoom:1;}`;
const document = '<link rel="stylesheet" href="/src/index.css"><body data-type-surface="screen"><span>Text</span>';
function diagnostics() { return checkTypography(root).join('\n'); }
function broken(file, replacement, problem) {
  const original = fs.readFileSync(path.join(root, file), 'utf8');
  try { write(file, replacement); assert.match(diagnostics(), problem); }
  finally { write(file, original); }
}

try {
  write(registryFile, JSON.stringify(manifest));
  write(sheet, css);
  const tokens = '@import "./design-system/typography-surfaces.css";\n@theme {--text-body:1rem;--text-control:.875rem;}';
  write('src/index.css', tokens);
  write(owner, app);
  write(dock, content);
  write('sample.html', document);
  assert.equal(diagnostics(), '');

  broken(dock, content.replace(' data-type-surface="node-input"', ''), /Dock\.tsx:1: \.dock must use data-type-surface="node-input"/);
  broken(sheet, css.replace('node-input', 'unrelated'), /unknown or unstyled typography surface.*node-input/);
  broken(sheet, css.replace('zoom:var(--canvas-conversation-scale)', 'color:red'), /unknown or unstyled typography surface.*node-input/);
  broken('src/index.css', '', /application must import/);
  broken('src/index.css', tokens.replace('--text-body:1rem;', ''), /registered role has no @theme definition: --text-body/);
  broken('sample.html', document.replace('<span>', '<span class="text-3xl">'), /sample.html:1: unregistered typography utility/);
  broken('sample.html', document.replace('<span>', '<span style="scale:2">'), /sample.html:1: scale: 2/);
  broken('sample.html', document.replace('<span>', '<span data-type-surface="portal">'), /no matching registered element/);
  broken('sample.html', document.replace('<span>', '<span data-type-surface="unknown">'), /no matching registered element/);
  write('public/new.html', document);
  assert.match(diagnostics(), /public\/new.html:1: HTML body requires/);
  remove('public/new.html');
  write('public/outer.css', '@import "./inner.css";');
  write('public/inner.css', '@import "/src/index.css";');
  write('sample.html', document.replace('/src/index.css', '/public/outer.css'));
  assert.equal(diagnostics(), '', 'a reachable, verified indirect stylesheet is valid');
  broken('public/inner.css', '.label {transform:scale(2)}', /public\/inner.css:1: transform: scale\(2\)/);
  broken('public/inner.css', '@import "./missing.css";', /stylesheet cannot be verified/);
  write('sample.html', document);
  broken(dock, content.replace('data-type-surface="node-input"', 'data-type-surface="portal"'), /\.dock must use/);
  broken(dock, content.replace('source', 'source<span className="dock" data-type-surface="node-input">duplicate</span>'), /applies its scale twice/);
  broken(owner, app.replace('<Dock/>', '<Dock/><span>Uncompensated</span>'), /canvas-geometry contains text/);
  broken(owner, app.replace('<Dock/>', '<Dock/>{flag && <span>{t("source")}</span>}'), /canvas-geometry contains text/);
  broken(owner, app.replace('export function Card', 'function Bare(){ return <span>unguarded</span>; }\nexport function Card').replace('<Dock/>', '<Bare/>'), /canvas-geometry contains text/);
  broken(owner, app + '\nexport function Unregistered() { return "bare"; }', /Unregistered renders UI without a typography registration/);
  broken(owner, app + '\nexport const NewLabel = () => "label";', /NewLabel renders UI without a typography registration/);
  broken(owner, app + '\nexport const NewLabel = ({label}) => label;', /NewLabel renders UI without a typography registration/);
  write('src/NewWidget.tsx', 'export const NewWidget = () => <span>new</span>;');
  assert.match(diagnostics(), /NewWidget\.tsx:1: NewWidget renders UI without a typography registration/);
  remove('src/NewWidget.tsx');
  broken(dock, content.replace('<span>source</span>', '{createPortal(<span>bare</span>, document.body)}'), /createPortal contains text/);
  broken(dock, 'import {createPortal as mount} from "react-dom";\n' + content.replace('<span>source</span>', '{mount("bare", document.body)}'), /createPortal contains text/);
  broken(dock, content.replace('return <aside', 'const pop = <span>bare</span>; return <aside').replace('source</span>', 'source{createPortal(pop, host)}</span>'), /createPortal contains text/);
  broken(dock, content.replace('return <aside', 'const style = {fontSize:32}; return <aside').replace('<span>', '<span style={style}>'), /inline fontSize/);
  broken(dock, content.replace('return <aside', 'function getStyle(){return {fontSize:32};} return <aside').replace('<span>', '<span style={getStyle()}>'), /inline fontSize/);
  broken(dock, content.replace('<span>', '<span style={{zoom:2}}>'), /inline zoom/);
  broken(dock, content.replace('<span>', '<span style={{transform:"scale(3)"}}>'), /inline transform/);
  broken(dock, content.replace('<span>', '<span className="hover:text-[42px]">'), /unregistered typography utility/);
  for (const utility of ['scale-150', 'md:[zoom:2]', 'text-[xx-large]', '![font-size:22px]', 'text-(length:--size)']) {
    broken(dock, content.replace('<span>', '<span className="' + utility + '">'), /unregistered typography utility/);
  }
  for (const code of [
    'el.style.transform = "scale(3)"', 'el.style.setProperty("transform","scale(2)")',
    'el.setAttribute("font-size","48px")', 'el.setAttribute("style","transform:scale(2)")',
    'el.style.cssText = "color:red; transform:scale(2)"',
    'el.style.setProperty("--canvas-conversation-scale","2")',
  ]) broken(dock, content.replace('return <aside', code + '; return <aside'), /bypasses|unregistered typography/);
  for (const code of ['el.className="text-3xl"', 'el.setAttribute("class","text-[42px]")', 'el.classList.add("ok","scale-150")']) {
    broken(dock, content.replace('return <aside', code + '; return <aside'), /unregistered DOM typography utility/);
  }
  broken('src/index.css', '@import "./design-system/typography-surfaces.css";\n.foo{--text-body:40px;--overview-zoom:2}', /can only be defined by/);
  write(dock, content.replace('source</span>', 'source<svg><path className="scale-150" /></svg></span>'));
  assert.equal(diagnostics(), '', 'a text-free geometric path may scale independently');
  write(dock, content);
  broken('src/index.css', '@import "./design-system/typography-surfaces.css";\n.label {font-size:42px}', /src\/index\.css:2: font-size: 42px/);
  broken('src/index.css', '@import "./design-system/typography-surfaces.css";\n.label {@apply text-3xl}', /@apply uses unregistered typography utility/);
  broken(dock, content + '\nexport const page = `<!doctype html><html><body>ungoverned</body></html>`;', /standalone HTML template requires a registered html boundary/);
  const page = 'src/page.ts';
  const registerPage = { ...manifest,
    modules: { ...manifest.modules, [page]: ['page'] },
    boundaries: { ...manifest.boundaries, [page]: { html: 'portal' } },
  };
  const template = 'import css from "./design-system/typography-surfaces.css?raw";\n' +
    'export const page = `<!doctype html><html data-type-surface="portal"><style>${css}</style><b>Text</b></html>`;';
  write(registryFile, JSON.stringify(registerPage));
  write(page, template);
  assert.equal(diagnostics(), '');
  broken(page, template.replace('${css}', ''), /does not embed the registered portal typography stylesheet/);
  broken(page, template.replace('${css}', '${css}b{font-size:90px}'), /font-size: 90px/);
  broken(page, template.replace('<b>', '<b style="transform:scale(8)">'), /transform: scale\(8\)/);
  broken(page, template.replace('<b>', '<b class="text-4xl">'), /unregistered HTML typography utility/);
  remove(page);
  write(registryFile, JSON.stringify(manifest));
  assert.equal(diagnostics(), '');
  console.log('PASS typography ownership, dock removal, portals, geometry, duplicate scaling and style bypass checks');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
