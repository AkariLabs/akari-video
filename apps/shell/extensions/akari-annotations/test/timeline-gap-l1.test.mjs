import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createFixture } from '../evidence/timeline-gap-generate/gen-fixture.mjs';
const runner = readFileSync(new URL('../evidence/timeline-gap-generate/l1-timeline-gap-generate.mjs', import.meta.url), 'utf8');
test('L1 fixture copies project-default, produces two real videos and passes edit-lint without Electron', async t => {
  const root = await mkdtemp(join(tmpdir(), 'akari-gap-fixture-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, 'project'), { edit } = await createFixture(project);
  assert.ok((await readFile(join(project, 'AGENTS.md'), 'utf8')).length > 0);
  assert.equal(edit.tracks[0].items[0].duration, 90); assert.equal(edit.tracks[0].items[1].at, 210);
  const lint = new URL('../../../../../packages/edit-lint/bin/edit-lint.mjs', import.meta.url);
  const { stdout } = await promisify(execFile)(process.execPath, [lint.pathname, project, '--json']);
  assert.equal(JSON.parse(stdout).verdict, 'pass');
});
test('L1 uses isolated roots, fake CLI, real mouse clicks, screenshots and layout checks', () => {
  assert.match(runner, /AKARI_HOME:path.join\(ISO/); assert.match(runner, /THEIA_CONFIG_DIR:path.join\(ISO/);
  assert.match(runner, /--user-data-dir=/); assert.match(runner, /AKARI_GENERATE_CLI:fakeCli/);
  assert.match(runner, /await realClick\(cdp,point.x,point.y\)/);
  assert.ok(new Set(runner.match(/\d\d-[a-z-]+\.png/g)).size >= 4);
  assert.match(runner, /gap.button.painted/); assert.match(runner, /overlapPairs\(gap.rects\)/);
  assert.match(runner, /assert.equal\(calls.length,0\)/);
  assert.doesNotMatch(runner, /commitGapFrame\(|selectGapAt\(/);
});
test('L1 browser measurement expressions are valid JavaScript', () => {
  const code = runner.slice(runner.indexOf('const GEOMETRY ='), runner.indexOf('async function listOwnedProcesses()'));
  const expressions = new Function(`${code};return [GAP,GENERATION,CHIP('gap-1')];`)();
  for (const expression of expressions) assert.doesNotThrow(() => new Function(expression));
});

const statusCode = runner.slice(runner.indexOf('const LINK_STEP ='), runner.indexOf('async function shot('));
const { LINK_STEP, measurementStatus } = new Function(`${statusCode};return {LINK_STEP,measurementStatus};`)();
for (const [name, observed, otherPass, expected] of [
  ['only link missing', false, true, 'fail'],
  ['link observed', true, true, 'pass'],
  ['link and another check fail', false, false, 'fail'],
  ['another check fails even with link', true, false, 'fail'],
  ['link not measured', undefined, true, 'fail']
]) test(`L1 final status: ${name}`, () => {
  assert.equal(measurementStatus({ steps: [{ name: LINK_STEP, pass: observed === true }, { name: 'edit-lint PASS', pass: otherPass }],
    linkIndicator: { observed, title: '次のクリップの絵につながる' } }), expected);
});
test('link failure is retained and allows every subsequent measurement to run', async () => {
  const output = { steps: [] }, saved = [];
  const stepCode = runner.slice(runner.indexOf('async function step('), runner.indexOf('const LINK_STEP ='));
  const step = new Function('output', 'clean', 'save', `${stepCode};return step;`)(output, String,
    async () => { saved.push(structuredClone(output)); });
  const call = runner.slice(runner.indexOf('  await step(LINK_STEP,'), runner.indexOf("  await step('edit-lint PASS',lint);"));
  assert.ok(call.length > 0); assert.match(call, /\},true\);/);
  output.linkIndicator = { observed: false };
  await new Function('step', 'LINK_STEP', 'output', 'assert', `return (async()=>{${call}})();`)(step, LINK_STEP, output, assert);
  for (const name of ['edit-lint PASS', 'no generation CLI invocation or paid provider request', 'screenshots']) {
    await step(name, async () => ({ measured: true }));
  }
  assert.equal(output.linkIndicator.observed, false);
  assert.equal(output.steps[0].pass, false); assert.match(output.steps[0].error, /🔗/);
  assert.ok(output.steps.slice(1).every(result => result.pass)); assert.equal(saved.length, 4);
  assert.equal(measurementStatus(output), 'fail');
  assert.doesNotMatch(runner, /assert\.ok\(output\.linkIndicator\?\.observed/);
});

test('L1 link title and link step must both pass', () => {
  for (const title of [undefined, '', 'wrong title']) {
    assert.equal(measurementStatus({ steps: [{ name: LINK_STEP, pass: true }],
      linkIndicator: { observed: true, title } }), 'fail');
  }
  assert.equal(measurementStatus({ steps: [{ name: LINK_STEP, pass: false }],
    linkIndicator: { observed: true, title: '次のクリップの絵につながる' } }), 'fail');
});
const measurementCode = runner.slice(runner.indexOf('const GEOMETRY ='), runner.indexOf('async function listOwnedProcesses()'));
const { CHIP, measureChipLayout, assertChipLayout } = new Function('assert',
  `${measurementCode};return {CHIP,measureChipLayout,assertChipLayout};`)(assert);
function chipFixture() {
  class Element {
    constructor(selector, left, right, top, bottom, textContent = '') {
      Object.assign(this, { selector, className: selector.replace(/^[.]/, ''), textContent,
        bounds: { left, right, top, bottom, width: right-left, height: bottom-top }, dataset: {},
        style: { display: 'block', visibility: 'visible', opacity: '1', backgroundImage: 'url(frame.png)' },
        pseudos: { '::before': 'none', '::after': 'none' } });
    }
    getClientRects() { return [this.bounds]; }
    getBoundingClientRect() { return this.bounds; }
  }
  const first = new Element('[data-akari-generation-frame]',433,469,525,561);
  const last = new Element('[data-akari-generation-frame]',487,522,525,561);
  first.dataset.akariGenerationFrame = 'first'; last.dataset.akariGenerationFrame = 'last';
  const badge = new Element('[data-akari-generation-badge]',435,489,522,536,'▶ 動画予定');
  const link = new Element('.akari-generation-link',506,520,537,549);
  link.title = '次のクリップの絵につながる'; link.pseudos['::before'] = '""';
  const firstLabel = new Element('.akari-generation-frame-label',435,455,550,560,'最初');
  const lastLabel = new Element('.akari-generation-frame-label',490,510,550,560,'最後');
  const name = new Element('.akari-annotations-strip-clip-header-label',433,490,505,517,'あいだを生成');
  const time = new Element('.akari-annotations-strip-clip-header-duration',495,522,505,517,'4.0 秒');
  const prompt = new Element('.akari-generation-prompt',471,485,538,549,'名前');
  const nodes = [first,last,badge,link,firstLabel,lastLabel,name,time,prompt];
  const chip = new Element('chip',433,522,500,565);
  nodes.forEach(node => { node.parentElement = chip; });
  chip.querySelectorAll = selector => nodes.filter(node => selector.split(',').includes(node.selector));
  chip.querySelector = selector => chip.querySelectorAll(selector)[0] ?? null;
  const document = { querySelector: () => chip };
  const window = { __akariGapWidget: { cutItemIds: ['gap-1'] } };
  const getComputedStyle = (node,pseudo) => pseudo ? { content: node.pseudos[pseudo] } : node.style;
  const measure = () => new Function('document','window','Element','getComputedStyle','innerWidth','innerHeight',
    `return ${CHIP('gap-1')}`)(document,window,Element,getComputedStyle,1200,900);
  return { measure, nodes, first, last, badge, link, name, time, firstLabel, lastLabel, prompt };
}
for (const [name,before,after,expected] of [
  ['empty span with before', '""', 'none', true],
  ['empty span with after', 'none', '""', true],
  ['both pseudo elements', '""', '""', true],
  ['no pseudo elements', 'none', 'none', false],
  ['normal content', 'normal', 'normal', false]
]) test(`L1 link observes CSS pseudo elements: ${name}`, () => {
  const f = chipFixture(); f.link.pseudos = { '::before': before, '::after': after };
  assert.equal(f.link.textContent, '');
  const { linkIndicator } = f.measure();
  assert.equal(linkIndicator.observed, expected);
  assert.equal(linkIndicator.title, '次のクリップの絵につながる');
  assert.deepEqual(linkIndicator.rect, f.link.bounds);
  assert.equal(linkIndicator.pseudo.before.content, before);
  assert.equal(linkIndicator.pseudo.before.present, before === '""');
  assert.equal(linkIndicator.pseudo.after.present, after === '""');
});
for (const hide of ['display','visibility','width','height','missing','parent']) test(`L1 invisible link is not observed: ${hide}`, () => {
  const f = chipFixture();
  if (hide === 'display') f.link.style.display = 'none';
  if (hide === 'visibility') f.link.style.visibility = 'hidden';
  if (hide === 'width' || hide === 'height') f.link.bounds[hide] = 0;
  if (hide === 'missing') f.nodes.splice(f.nodes.indexOf(f.link),1);
  if (hide === 'parent') {
    f.link.parentElement = f.name; f.name.style.display = 'none';
  }
  assert.equal(f.measure().linkIndicator.observed, false);
});
test('L1 link text alone cannot replace a pseudo element', () => {
  const f = chipFixture(); f.link.textContent = '🔗'; f.link.pseudos['::before'] = 'none';
  assert.equal(f.measure().linkIndicator.observed, false);
});
test('03 layout permits foreground on pictures and records those overlaps separately', () => {
  const f = chipFixture(), chip = f.measure(), layout = measureChipLayout(chip);
  assert.equal(chip.frames.length,2); assert.equal(chip.foregroundRects.length,7);
  assert.deepEqual(layout.foregroundOverlaps,[]); assert.deepEqual(layout.pictureOverlaps,[]);
  assert.ok(layout.overlapsOnPictures.some(({a,b}) => a.role === f.link.className && b.side === 'last'));
  assert.ok(layout.overlapsOnPictures.some(({a,b}) => a.text === '▶ 動画予定' && b.side === 'first'));
  assert.ok(layout.overlapsOnPictures.some(({a}) => a.text === '最初'));
  assert.ok(layout.overlapsOnPictures.some(({a}) => a.text === '最後'));
  assert.doesNotThrow(() => assertChipLayout(layout));
  assert.match(runner, /screenshot:'03-video-draft.png',chip,\.\.\.measureChipLayout\(chip\)/);
  assert.match(runner, /assertChipLayout\(output.chipLayout\)/);
});
for (const target of ['badge','name','time','firstLabel','lastLabel','prompt']) test(`03 layout rejects foreground collisions: link and ${target}`, () => {
  const f = chipFixture(); f[target].bounds = { ...f.link.bounds };
  const layout = measureChipLayout(f.measure());
  assert.ok(layout.foregroundOverlaps.length > 0);
  assert.throws(() => assertChipLayout(layout), /foreground/);
});
test('03 layout rejects overlapping first and last picture cells', () => {
  const f = chipFixture(); f.last.bounds = { ...f.first.bounds };
  const layout = measureChipLayout(f.measure());
  assert.deepEqual(layout.foregroundOverlaps,[]); assert.equal(layout.pictureOverlaps.length,1);
  assert.throws(() => assertChipLayout(layout), /picture cells/);
});
