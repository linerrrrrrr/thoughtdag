import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/lib/overview-ruler.ts'], bundle: true, platform: 'node', format: 'esm',
  loader: { '.css': 'text' }, write: false });
const { overviewRulerMarks, overviewRulerTicks, isOverviewRulerHandle, resolveRulerHandle, remapOverviewRulerHandle } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
const base = { question: '', response: '', attachments: [], highlights: [] };
const mark = { id: 'id/含%20', text: 'read here' };
const passage = 'read **here** and [there](https://example.org/a/long/url)\n\n```txt\nread here\n```\n\nread here';
const answer = { ...base, response: passage, highlights: [mark] };
const repeat = overviewRulerMarks(answer);
assert.equal(repeat.length, 2, 'Only highlighted prose has ruler handles');
assert.deepEqual(repeat.map(item => item.occurrence), [0, 1]);
assert.notEqual(repeat[0].id, repeat[1].id);
const fallbackTicks = overviewRulerTicks(repeat, 100);
const measuredTicks = overviewRulerTicks(repeat, 100, 1, new Map([[repeat[1].id, 0]]));
assert.equal(measuredTicks[0].mark, repeat[1], 'Measuring layout preserves the passage identity and source fraction');
assert.equal(measuredTicks[0].top, 0, 'A measured zero is a valid track position');
assert.equal(measuredTicks[1].top, fallbackTicks[0].top);
assert.equal(overviewRulerTicks(repeat, 100), fallbackTicks, 'Screen coordinates never enter the source geometry cache');
assert.ok(repeat[0].fraction < .2 && repeat[1].fraction > .8);
assert.equal(overviewRulerMarks(answer), repeat, 'Canvas geometry can reuse the marks by data identity');
assert.equal(overviewRulerMarks({ ...answer, response: 'no matching text' }).length, 0);
const remapped = remapOverviewRulerHandle(repeat[1].id, new Map(), new Map([[mark.id, 'copy']]));
assert.equal(remapped, overviewRulerMarks({ ...answer, highlights: [{ ...mark, id: 'copy' }] })[1].id);
assert.ok(repeat.every(item => isOverviewRulerHandle(item.id)));
assert.equal(isOverviewRulerHandle('source-right'), false);

const prompt = { ...mark, id: 'instruction', source: 'question' };
const conversation = { ...answer, question: 'read here', attachments: [], highlights: [prompt, mark] };
const scoped = overviewRulerMarks(conversation);
assert.deepEqual(scoped.map(item => [item.source, item.occurrence]), [['question', 0], [undefined, 0], [undefined, 1]]);
assert.deepEqual(scoped.slice(1).map(item => item.id), repeat.map(item => item.id), 'Existing response wires keep their handles');
const [questionOnly, ...leaked] = overviewRulerMarks({ ...conversation, highlights: [prompt], attachments: [
  { id: 'also-read-here', type: 'text/plain', content: 'read here' },
] });
assert.equal(questionOnly.id, scoped[0].id);
assert.deepEqual(leaked, [], 'Question highlights do not produce answer or attachment ticks');

const shortQuestion = 'Which observations changed?';
const longAnswer = ['Early observation.', 'Unchanged reading. '.repeat(180), 'Final observation.'].join('\n\n');
const questionAndAnswer = { ...base, question: shortQuestion, response: longAnswer,
  highlights: [{ id: 'early', text: 'Early observation.' }, { id: 'late', text: 'Final observation.' }] };
const bodyTicks = overviewRulerMarks(questionAndAnswer);
assert.ok(bodyTicks[0].fraction < .03 && bodyTicks[1].fraction > .97);
const questionHighlight = { id: 'whole-question', text: shortQuestion, source: 'question' };
const withQuestionMark = overviewRulerMarks({ ...questionAndAnswer, highlights: [questionHighlight, ...questionAndAnswer.highlights] });
assert.ok(withQuestionMark[0].fraction < bodyTicks[0].fraction);
assert.deepEqual(withQuestionMark.slice(1), bodyTicks, 'Highlighting the question leaves the answer coordinates stable');
const attachments = Array.from({ length: 8 }, (_, i) => ({ id: 'attachment-' + i, type: 'text/plain', content: 'Attached note.' }));
assert.deepEqual(overviewRulerMarks({ ...questionAndAnswer, attachments }), bodyTicks, 'Attached files do not shorten the answer ruler');
const mixed = overviewRulerMarks({ ...questionAndAnswer, attachments, highlights: [
  ...questionAndAnswer.highlights, { id: 'file-highlight', attachmentId: attachments[0].id, text: 'Attached note.' },
] });
assert.deepEqual(mixed.filter(item => !item.attachmentId), bodyTicks);
assert.equal(mixed.find(item => item.attachmentId)?.id, 'ruler/text/attachment-0/file-highlight/0');
const overlapping = { ...answer, attachments: [{ id: 'f', type: 'text/plain', content: 'read here. read here.' }] };
assert.deepEqual(overviewRulerMarks(overlapping), repeat, 'Matching attachment text cannot duplicate an answer tick');
const alias = repeat[1].id.replace('text//', 'text/f/');
assert.equal(resolveRulerHandle(overlapping, alias), repeat[1].id, 'Old wires follow the same occurrence of their answer highlight');
assert.equal(resolveRulerHandle(overlapping, alias.slice(0, -1) + '9'), repeat[0].id);
assert.equal(resolveRulerHandle(overlapping, alias.replace('text/f/', 'text/missing/')), undefined);
const remarked = { ...overlapping, highlights: [mark, { ...mark, id: 'chosen-file', attachmentId: 'f' }] };
assert.deepEqual(overviewRulerMarks(remarked).filter(mark => mark.attachmentId).map(mark => mark.id),
  ['ruler/text/f/chosen-file/0', 'ruler/text/f/chosen-file/1'], 'The same passage can be marked independently in the file');
assert.equal(overviewRulerMarks({ ...overlapping, response: 'different answer' }).filter(mark => mark.attachmentId === 'f').length, 2,
  'Legacy attachment-only passages retain their original file handles');
const longPrompt = 'Context. '.repeat(180) + 'Question ends.';
const [lateQuestion, earlyAnswer] = overviewRulerMarks({ ...base, question: longPrompt, response: 'Yes!',
  highlights: [{ id: 'q', source: 'question', text: 'Question ends.' }, { id: 'a', text: 'Yes!' }] });
assert.ok(lateQuestion.fraction > .97 && lateQuestion.fraction < earlyAnswer.fraction);

const same = { ...base, stepKind: 'file', attachments: [
  { id: 'file:/1', type: 'text/plain', content: 'read here' },
  { id: 'file:/2', type: 'text/plain', content: 'read here' },
], highlights: [mark] };
assert.deepEqual(overviewRulerMarks(same).map(item => item.fraction), [.25, .75]);
assert.deepEqual(overviewRulerMarks({ ...same, highlights: [{ ...mark, attachmentId: 'file:/2' }] })
  .map(item => item.attachmentId), ['file:/2']);
assert.ok(overviewRulerMarks({ ...base, stepKind: 'note', question: passage, highlights: [mark] }).length === 2);

const rect = { id: 'area', page: 2, rects: [[.1, .2, .6, .2]], color: '#acb123', text: '' };
const pdf = { id: 'pdf:/1', type: 'application/pdf', numPages: 4, pdfAnnotations: [
  rect,
  { ...rect, id: 'pin', kind: 'note' },
  { ...rect, id: 'legacy-pin', comment: 'comment', rects: [[.3, .2, .025, .018]] },
], pdfSavedAnnotations: [rect] };
const [area, ...other] = overviewRulerMarks({ ...base, attachments: [pdf] });
assert.equal(other.length, 0, 'Skip point notes and retain just the current annotation revision');
assert.equal(area.fraction, (1 + .3) / 4);
assert.equal(area.color, rect.color);
assert.equal(area.page, 2);
const docx = { id: 'docx%', name: 'native.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  documentHighlights: [{ id: 'docx/run', text: 'Native mark', color: '#ffff00', fraction: .5 }] };
const native = overviewRulerMarks({ ...base, attachments: [pdf, docx] });
assert.deepEqual(native.map(item => item.fraction), [area.fraction / 2, .75]);
assert.deepEqual(native.map(item => item.attachmentId), [pdf.id, docx.id]);
const pdfCopy = overviewRulerMarks({ ...base, attachments: [{ ...pdf, id: 'copy/pdf' }] })[0];
assert.equal(pdfCopy.id, remapOverviewRulerHandle(area.id, new Map([[pdf.id, 'copy/pdf']]), new Map()));
assert.equal(remapOverviewRulerHandle('source-right', new Map(), new Map()), 'source-right');
console.log('PASS overview ruler text positions, PDF and native document marks, attachment scopes and copied endpoints');
