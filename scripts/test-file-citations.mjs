import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';

const compiled = await build({ entryPoints: ['src/lib/remark-file-citations.ts'], bundle: true, format: 'esm', platform: 'node', write: false });
const { remarkFileCitations } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkFileCitations);
const plain = unified().use(remarkParse).use(remarkGfm);
const parse = text => parser.runSync(parser.parse(text));
const nodesOf = (tree, type) => [tree, ...(tree.children ?? []).flatMap(child => nodesOf(child, type))].filter(node => node.type === type);
const citation = (path, prefix = ':') => `${prefix}codex-file-citation{path="${path}" purpose="output"}`;
const root = 'C:/Users/31918/.thoughtdag/workspaces/ab0b5ce3-5286-4d33-8198-067607036c77/output/pdf';
const text = `已拆成 **9 份 PDF**。\n\n[下载全部分册](${root}/论文_章节分割_9份.zip)\n\n摘要与论文信息：${citation(`${root}/chapters/00_Abstract.pdf`)}\n\n第 5 章：${citation(`${root}/chapters/05_Robustness_and_Supplementary_Analysis.pdf`, '::')}`;
const links = nodesOf(parse(text), 'link');
assert.deepEqual(links.map(link => link.url), [`${root}/论文_章节分割_9份.zip`, `${root}/chapters/00_Abstract.pdf`, `${root}/chapters/05_Robustness_and_Supplementary_Analysis.pdf`]);
assert.equal(links[1].children[0].value, '00_Abstract.pdf');
assert.equal(nodesOf(parse(text), 'text').some(node => node.value.includes('codex-file-citation')), false);
assert.equal(nodesOf(parse(citation('C:\\work\\中文 文件.pdf')), 'link')[0].url, 'C:/work/中文 文件.pdf');
assert.equal(nodesOf(parse(":codex-file-citation{purpose='output' path='output/中文 文件.pdf'}"), 'link')[0].url, 'output/中文 文件.pdf');
assert.equal(nodesOf(parse(`${citation('/tmp/a.pdf')} 和 ${citation('/tmp/b.pdf')}`), 'link').length, 2);
console.log('PASS native file citations render as filename links, preserving Windows/Unicode/relative paths and surrounding prose');

const sample = citation('C:/work/a.pdf');
for (const example of [`\`${sample}\``, `\`\`\`text\n${sample}\n\`\`\``, `~~~\n${sample}\n~~~`, `    ${sample}`]) {
  assert.equal(nodesOf(parse(example), 'link').length, 0, example);
}
assert.equal(nodesOf(parse(`[${sample}](https://example.com)`), 'link').length, 1, 'No nested links');
for (const invalid of [citation('javascript:alert(1)'), citation('https://example.com/a.pdf'), citation('//server/share/a.pdf'), citation(''), ':codex-file-citation{path="C:/work/a.pdf"', ':codex-file-citation{path="C:/a.pdf" path="C:/b.pdf"}']) {
  assert.deepEqual(parse(invalid), plain.runSync(plain.parse(invalid)), invalid);
}
console.log('PASS code examples, incomplete citations and unsafe paths do not become file actions');
