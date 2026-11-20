import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkCursors } from './check-cursors.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thoughtdag-cursor-registry-'));
const sheet = 'runtime/design-system/cursors.css';
const owners = 'src/View.tsx';
const rules = `button, a[href], select, summary, [role="button"] { cursor: pointer }
input, textarea, pre[tabindex] { cursor: text }
button:disabled { cursor: default }
[data-cursor="action"] { cursor: pointer }
[data-cursor="grip"] { cursor: grab }
[data-cursor="active-grip"] { cursor: grabbing }
.splitter { cursor: ew-resize }`;
const appImport = '@import "../runtime/design-system/cursors.css";';
const ok = `export function View({active}) {
  return <><div onClick={e => { if (active) e.stopPropagation(); }}><button disabled onClick={go}>OK</button></div>
    <a href="/about">About</a><div role="button" tabIndex={0} onClick={go} />
    <button draggable data-cursor="grip" onDragStart={drag}/>
    <div className="splitter" onPointerDown={drag} />
    <pre tabIndex={active ? 0 : undefined}>text</pre>
    <div data-cursor={active ? 'active-grip' : 'grip'} onPointerDown={drag}/></>;
}`;
const index = '<!doctype html><link rel="stylesheet" href="/runtime/design-system/cursors.css"><body></body>';
function write(file, text) {
  fs.mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), text);
}
function reject(file, text, reason) {
  const filename = path.join(root, file);
  const original = fs.existsSync(filename) ? fs.readFileSync(filename) : null;
  try {
    write(file, text);
    assert.match(checkCursors(root).join('\n'), reason);
  } finally {
    if (original) fs.writeFileSync(filename, original);
    else fs.unlinkSync(filename);
  }
}
const unowned = /interactive target has no cursor registration/;
try {
  write(sheet, rules);
  write('src/index.css', appImport);
  write(owners, ok);
  write('index.html', index);
  assert.deepEqual(checkCursors(root), []);
  reject(owners, ok.replace('data-cursor={active ? \'active-grip\' : \'grip\'}', ''), unowned);
  reject(owners, ok.replace("'grip'", "'typo'"), /unknown or dynamic data-cursor/);
  reject(owners, ok.replace("\'grip\'", 'undefined'), unowned);
  reject('src/New.tsx', 'export const Fresh = () => <span onClick={run}/>;', unowned);
  reject(owners, 'const a = <button draggable onDragStart={drag}/>;', unowned);
  reject(owners, 'const a = <button onPointerDown={start} onPointerMove={move}/>;', unowned);
  const grips = 'const handles = (["width","height"] as const).map(d => <button className={`resize-${d}`} onPointerDown={start} onPointerMove={move}/>);';
  write(owners, grips);
  write(sheet, rules + '\n.resize-width {cursor:ew-resize} .resize-height {cursor:ns-resize}');
  assert.deepEqual(checkCursors(root), []);
  reject(sheet, rules + '\n.resize-width {cursor:ew-resize}', unowned);
  write(owners, ok);
  write(sheet, rules);
  reject(owners, 'function Box(props) {return <div {...props}/>;} const example = <Box onClick={go}/>;', unowned);
  reject(owners, 'const a = <div className={active ? "splitter" : "ordinary"} onPointerDown={start}/>;', unowned);
  reject(owners, 'const a = React.createElement("div", {onClick: go});', unowned);
  reject(owners, 'const a = document.createElement("div"); a.addEventListener("click", go);', unowned);
  reject(owners, 'const a = document.createElement("div"); a.onclick = go;', unowned);
  reject(owners, 'const a = document.createElement("button"); a.addEventListener("dragstart", go);', unowned);
  reject(owners, 'const a = <div id="tap"/>; document.querySelector("#tap").addEventListener("click", go);', unowned);
  reject('public/listener.html', index.replace('</body>', '<div id="tap"></div><script>document.getElementById("tap").onclick=go</script></body>'), unowned);
  reject(sheet, rules.replace('button,', ''), /missing native cursor registration for button/);
  reject(sheet, rules.replace('button:disabled { cursor: default }', ''), /missing native cursor registration for button:disabled/);
  reject('src/index.css', 'body { color: black }', /must import/);
  reject('src/Widget.css', '.control { cursor: grab }', /cursor declarations belong/);
  reject('src/Widget.css', '.control { @apply hover:cursor-crosshair }', /cursor utility/);
  reject(owners, 'const a = <button className="active:cursor-grabbing"/>;', /cursor utility/);
  reject(owners, 'const a = <svg cursor="crosshair"/>;', /SVG cursor/);
  reject(owners, 'const css = {cursor: "grab"}; const a = <button style={{...css}}/>;', /inline cursor/);
  reject(owners, 'const style = () => ({cursor:"grab"}); const a = <button style={style()}/>;', /inline cursor/);
  reject(owners, 'el.style["cursor"] = "grab";', /imperative style.cursor/);
  reject(owners, 'el.style.setProperty("cursor","grab");', /imperative cursor/);
  reject(owners, 'Object.assign(el.style, {cursor:"wait"});', /inline cursor/);
  reject(owners, 'export const fromOtherModule = {["cursor"]:"wait"};', /inline cursor/);
  reject(owners, 'el.style.cssText = "color:red; cursor: grab";', /cssText contains/);
  reject(owners, 'el.dataset.cursor = "unknown";', /unknown or dynamic/);
  reject('public/demo.html', index.replace('<body>', '<body style="cursor:wait">'), /inline CSS cursor/);
  reject('public/demo.html', index.replace('</body>', '<div onclick="go()"></div></body>'), unowned);
  reject('public/demo.html', index.replace('</body>', '<script>document.body.style.cursor="grab"</script></body>'), /imperative style.cursor/);
  reject('public/demo.html', '<button>Continue</button>', /must load its registered cursor stylesheet/);
  reject(owners, 'const page = `<!doctype html><html><body><button>OK</button></body></html>`;', /must embed the registered/);
  reject(owners, 'const fragment = `<span style="cursor: pointer">click</span>`;', /inline CSS cursor/);
  assert.deepEqual(checkCursors(root), []);
  console.log('PASS cursor registry, native controls, custom handlers, style bypasses and standalone documents');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
