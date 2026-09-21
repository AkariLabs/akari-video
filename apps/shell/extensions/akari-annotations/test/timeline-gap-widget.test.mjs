import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { AkariAnnotationsServiceImpl } from '../lib/node/akari-annotations-service.js';
import { plannedStillMeta, withNextVideoDraft } from '../../../../../packages/generate/src/cli/meta-still.mjs';
import { validateGenerationMeta } from '../../../../../packages/generate/src/cli/meta-validate.mjs';
import { insertItem, indexEditV2Items } from '../lib/common/edit-v2-mutations.js';
import { timelineGapAt } from '../lib/common/timeline-gap.js';
import { describeNextDraft } from '@akari-video/edit-store';
const source = readFileSync(new URL('../lib/browser/akari-annotations-widget.js', import.meta.url), 'utf8');
const from = source.indexOf('    gapSnapshot('), to = source.indexOf('    async commitEmptyFrame(', from);
const Widget = new Function('timeline_gap_1', 'edit_v2_mutations_1', 'buffer_1', 'akari_annotations_commands_2',
  `return class { ${source.slice(from, to)} }`)({ timelineGapAt }, { insertItem, indexEditV2Items },
  { BinaryBuffer: { fromString: s => s } }, { OPEN_AKARI_INSPECTOR_ID: 'akari.inspector.open' });
function fixture(fail) {
  let doc = { version: 2, output: { fps: 30 }, sources: [{ id: 'a', path: 'assets/a.mp4' }, { id: 'b', path: 'assets/b.mp4' }],
    tracks: [{ id: 'v', lane: 'visual', items: [
      { id: 'a', name: '動画A', at: 0, duration: 90, source: { kind: 'media', src: 'a', in: 2, out: 5 } },
      { id: 'b', name: '動画B', at: 210, duration: 90, source: { kind: 'media', src: 'b', in: 1, out: 4 } }
    ] }] };
  const before = JSON.stringify(doc), history = [], calls = [], notices = [], writes = [];
  let paidCalls = 0;
  const uri = { toString: () => 'file:///fixture', resolve: p => p };
  const call = name => { calls.push(name); if (fail === name) throw new Error(name); };
  const widget = Object.assign(new Widget(), {
    location: { root: uri, editUri: uri }, fps: 30, focusScope: { rootId: null }, gapRoot: uri.toString(),
    annotationsService: {
      async extractSourceFrame(request) { call(request.which); return { relativePath: `assets/captures/${request.which}.png`, sha256: request.which }; },
      async createEmptyGenerationFrame() { call('card'); return { relativePath: 'assets/generated/card.png' }; },
      async readGenerationDefaults() { call('defaults'); return { video: 'fal:h3-i2v' }; },
      async startGenerateVideo() { paidCalls++; throw new Error('PAID'); }
    },
    fileService: { async readFile() { call('read'); return { value: JSON.stringify(plannedStillMeta({ prompt: '', duration_s: 4, at: '2026-09-22T00:00:00Z', asOf: '2026-09-12' })) }; },
      async writeFile(uri, content) { call('write'); writes.push({ uri, meta: JSON.parse(content) }); } },
    showNotice: m => notices.push(m), errorMessage: e => e.message,
    commands: { async executeCommand(id, options) { calls.push({ id, options }); } },
    cutItemIds: [], timelineTreeRows: [], applySelection(selection) { this.selection = selection; this.selectedGap = undefined; },
    async commitEditMutation(label, mutate) { call('commit'); const old = doc; doc = mutate(doc);
      history.push({ label, undo: () => { doc = old; } }); this.cutItemIds = doc.tracks[0].items.map(item => item.id); }
  });
  Object.defineProperty(widget, 'editDocument', { get: () => doc });
  widget.selectedGap = timelineGapAt(doc.tracks[0], 120, 30);
  return { widget, before, history, calls, notices, writes, get doc() { return doc; }, get paidCalls() { return paidCalls; } };
}
test('gap snapshot samples trimmed source out minus one frame / next source in', () => {
  const f = fixture(), snapshot = f.widget.gapSnapshot();
  assert.equal(snapshot.kind, 'gap'); assert.equal(snapshot.startSeconds, 3); assert.equal(snapshot.endSeconds, 7);
  assert.equal(snapshot.previous.atSeconds, 5 - 1 / 30); assert.equal(snapshot.next.atSeconds, 1);
  assert.equal(snapshot.previous.label, '動画A');
});
test('image endpoints use source path and zero time; unsupported endpoints remain empty', () => {
  const f = fixture(); f.doc.sources[0].path = 'assets/a.png'; f.doc.tracks[0].items[1].source = { kind: 'html', src: 'b' };
  const snapshot = f.widget.gapSnapshot(); assert.equal(snapshot.previous.kind, 'image'); assert.equal(snapshot.previous.atSeconds, 0);
  assert.equal(snapshot.next, undefined);
});
test('gap confirmation stores both paths and first-last next before one mutation, sends nothing, undo removes item + source', async () => {
  const f = fixture(); await f.widget.gapSnapshot().createFrame();
  assert.equal(f.history.length, 1); assert.equal(f.history[0].label, 'あいだを生成の枠を置く');
  const meta = f.writes[0].meta;
  assert.equal(meta.next.inputs.first_frame.path, 'assets/captures/last.png');
  assert.equal(meta.next.inputs.last_frame.path, 'assets/captures/first.png');
  assert.equal(meta.next.inputs.frames_or_refs, 'frames'); assert.equal(meta.next.output.duration_s, 4);
  assert.equal(meta.next.model.id, 'fal:h3-i2v'); assert.equal(describeNextDraft(meta).variety, 'first-last');
  assert.ok(f.calls.indexOf('write') < f.calls.indexOf('commit'));
  const inserted = f.doc.tracks[0].items.find(i => i.id.startsWith('gap-'));
  assert.equal(inserted.at, 90); assert.equal(inserted.duration, 120); assert.equal(inserted.source.out, 4);
  assert.equal(f.doc.sources.length, 3); assert.equal(f.paidCalls, 0);
  assert.deepEqual(f.calls.at(-1), { id: 'akari.inspector.open', options: { tabId: 'generation' } });
  f.history[0].undo(); assert.equal(JSON.stringify(f.doc), f.before);
});
for (const fail of ['last', 'first', 'card', 'defaults', 'read', 'write', 'commit']) {
  test(`failure at ${fail} keeps edit byte-identical and has no undo or paid call`, async () => {
    const f = fixture(fail); await f.widget.gapSnapshot().createFrame();
    assert.equal(JSON.stringify(f.doc), f.before); assert.equal(f.history.length, 0); assert.equal(f.paidCalls, 0);
    assert.match(f.notices[0], /枠を置けません/); assert.equal(f.widget.gapCommitting, false);
  });
}
test('both endpoints without pictures produce a prompt-only draft', async () => {
  const f = fixture(); f.doc.tracks[0].items.forEach(i => { i.source.kind = 'html'; });
  await f.widget.gapSnapshot().createFrame();
  assert.equal(describeNextDraft(f.writes[0].meta).variety, 'prompt'); assert.equal(f.history.length, 1);
  assert.ok(!f.calls.includes('first') && !f.calls.includes('last')); assert.equal(f.paidCalls, 0);
});
test('stale/duplicate confirmations do not insert a second frame', async () => {
  const f = fixture(), snapshot = f.widget.gapSnapshot();
  await Promise.all([snapshot.createFrame(), snapshot.createFrame()]); await snapshot.createFrame();
  assert.equal(f.history.length, 1);
});
for (const mutation of [f => { f.doc.tracks[0].items[1].at = 180; }, f => { f.doc.tracks[0].items[0].source.out = 4; },
  f => { f.doc.sources[0].path = 'assets/changed.mp4'; }, f => { f.doc.tracks[0].locked = true; },
  f => { f.doc.output.fps = 24; }]) test('revalidate gap and endpoints after asynchronous preparation', async () => {
  const f = fixture(), snapshot = f.widget.gapSnapshot(); mutation(f); const before = JSON.stringify(f.doc);
  await snapshot.createFrame(); assert.equal(JSON.stringify(f.doc), before); assert.equal(f.history.length, 0);
});
const pointerFrom = source.indexOf('    onStripPointerDown('), pointerTo = source.indexOf('    timelineSelectionFromElement(', pointerFrom);
const PointerWidget = new Function('Element', 'DRAG_THRESHOLD_PX', `return class { ${source.slice(pointerFrom, pointerTo)} }`)(class {}, 3);
for (const [type, shiftKey, dragged, expected] of [['pointerup', false, false, 1], ['pointerup', true, false, 0],
  ['pointercancel', false, false, 0], ['pointerup', false, true, 0]]) {
  test(`pointer gap route ${type}, shift=${shiftKey}, drag=${dragged}`, () => {
    const listeners = new Map(); let selections = 0, seeks = 0;
    const widget = Object.assign(new PointerWidget(), { toolMode: 'select',
      strip: { setPointerCapture() {}, addEventListener: (n, f) => listeners.set(n, f), removeEventListener() {}, querySelectorAll: () => [] },
      timelineOverlay: { getBoundingClientRect: () => ({ left: 0, top: 0 }) }, selectionMarquee: { style: {} },
      selectGapAt() { selections++; return true; }, selectTimeAtClientX() { seeks++; }, applySelection() {} });
    widget.onStripPointerDown({ button: 0, clientX: 100, clientY: 20, pointerId: 1, shiftKey });
    if (dragged) listeners.get('pointermove')({ clientX: 120, clientY: 20 });
    listeners.get('pointerup')({ type, clientX: dragged ? 120 : 100, clientY: 20 });
    assert.equal(selections, expected); assert.equal(seeks, expected);
  });
}

test('unsupported last frame stays in draft: first-last label, validation error, hidden unsupported field, no auto model switch', async () => {
  const { generationFields } = await import('../lib/browser/inspector/generation-fields.js');
  const { validateInputs } = await import('../../../../../packages/generate/src/validate-inputs.mjs');
  const catalog = JSON.parse(readFileSync(new URL('../../../../../packages/schemas/gen-models.json', import.meta.url), 'utf8')).models;
  const model = catalog.find(m => m.kind === 'video' && m.inputs.first_frame !== 'none' && m.inputs.last_frame === 'none');
  assert.ok(model);
  const f = fixture(); f.widget.annotationsService.readGenerationDefaults = async () => ({ video: model.id });
  await f.widget.gapSnapshot().createFrame();
  const next = f.writes[0].meta.next;
  const validation = validateInputs({ model, inputs: next.inputs, output: next.output });
  assert.equal(next.model.id, model.id); assert.ok(next.inputs.last_frame);
  assert.equal(validation.ok, false); assert.ok(validation.messages.some(m => m.code === 'last_frame.unsupported'));
  const fields = generationFields({ snapshot: {}, catalogRow: model,
    draft: { modelId: model.id, inputs: next.inputs, output: next.output }, validation, defaults: { catalog },
    actions: Object.fromEntries(['update', 'generate', 'copyAdjacent', 'resume', 'retry'].map(k => [k, async () => ({ ok: true })])) });
  assert.equal(fields.find(f => f.name === 'generation-variety').getValue(), '最初→最後');
  assert.ok(!fields.some(f => f.name === 'last_frame')); assert.equal(f.paidCalls, 0);
});
test('model duration rounding is available to existing validator without stretching the gap item', async () => {
  const { validateInputs } = await import('../../../../../packages/generate/src/validate-inputs.mjs');
  const model = JSON.parse(readFileSync(new URL('../../../../../packages/schemas/gen-models.json', import.meta.url), 'utf8')).models.find(m => m.id === 'fal:h3-i2v');
  const f = fixture(); await f.widget.gapSnapshot().createFrame();
  const next = f.writes[0].meta.next, result = validateInputs({ model, inputs: next.inputs, output: next.output });
  assert.equal(result.rounded.duration_s.from, 4); assert.equal(result.rounded.duration_s.to, 5);
  assert.equal(f.doc.tracks[0].items.find(i => i.id.startsWith('gap-')).duration, 120);
});
const selectStart = source.indexOf('    applySelection('), selectEnd = source.indexOf('    publishPrimaryPreviewSelection(', selectStart);
const SelectionWidget = new Function(`return class { ${source.slice(selectStart, selectEnd)} }`)();
for (const selection of [undefined, { kind: 'cut', index: 0 }]) test(`normal selection clears gap and band: ${selection?.kind ?? 'empty/Esc'}`, () => {
  let removed = 0, pushed = 0;
  const widget = Object.assign(new SelectionWidget(), { selectedGap: {}, gapBand: { remove() { removed++; } }, multiSelection: [],
    exitTrimmerModeUnlessSelected() {}, selectionKey: x => x ? `${x.kind}:${x.index}` : '',
    pushSelectionSnapshot() { pushed++; }, applySelectionClass() {}, publishPrimaryPreviewSelection() {}, syncRightPane() {}, revealOutputPreview() {} });
  widget.applySelection(selection); assert.equal(widget.selectedGap, undefined); assert.equal(removed, 1); assert.equal(pushed, 1);
});

for (const hasEndpoints of [true, false]) test(`gap draft on actual createEmptyGenerationFrame meta validates: endpoints=${hasEndpoints}`, async t => {
  const root = await mkdtemp(join(tmpdir(), 'akari-gap-meta-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const f = fixture(), service = new AkariAnnotationsServiceImpl();
  Object.assign(f.doc.output, { width: 640, height: 360 });
  if (!hasEndpoints) f.doc.tracks[0].items.forEach(item => { item.source.kind = 'html'; });
  const before = JSON.stringify(f.doc);
  await writeFile(join(root, 'edit.json'), before);
  // Use the real RPC and real local PNG renderer, selecting the same no-browser
  // fallback as timeline-frame-rpc.test.mjs. No paid CLI/provider is involved.
  const cardUrl = new URL('../../../../../packages/generate/src/cli/text-card.mjs', import.meta.url).href;
  const cardModule = join(root, 'text-card-test.mjs');
  await writeFile(cardModule, `import { renderTextCard as render } from ${JSON.stringify(cardUrl)};
    export const renderTextCard = options => render({...options, loadPuppeteer: async()=>null,
      resolveBinary:()=>{throw new Error('no ffmpeg')}, logRenderer:()=>{}});`);
  const findAsset = service.findGenerationAsset.bind(service);
  service.findGenerationAsset = target => target.endsWith('/text-card.mjs') ? Promise.resolve(cardModule) : findAsset(target);
  let cardMeta, metaPath;
  f.widget.annotationsService.createEmptyGenerationFrame = async request => {
    const result = await service.createEmptyGenerationFrame({ ...request, projectRootUri: pathToFileURL(root).href });
    metaPath = join(root, `${result.relativePath}.meta.json`);
    cardMeta = JSON.parse(await readFile(metaPath, 'utf8'));
    assert.deepEqual(validateGenerationMeta(cardMeta), { ok: true, errors: [] });
    return result;
  };
  f.widget.annotationsService.extractSourceFrame = async request => ({
    relativePath: `assets/captures/${request.which}.png`, sha256: (request.which === 'first' ? 'a' : 'b').repeat(64)
  });
  f.widget.fileService = {
    async readFile(uri) { return { value: await readFile(join(root, uri)) }; },
    async writeFile(uri, content) { await writeFile(join(root, uri), content); }
  };
  await f.widget.gapSnapshot().createFrame();
  assert.equal(f.history.length, 1, f.notices.join('\n'));
  const meta = JSON.parse(await readFile(metaPath, 'utf8'));
  assert.deepEqual(validateGenerationMeta(meta), { ok: true, errors: [] });
  const { next, ...still } = meta;
  assert.deepEqual(still, cardMeta, 'the original still metadata stays intact');
  const schema = JSON.parse(readFileSync(new URL('../../../../../packages/schemas/generation-meta.schema.json', import.meta.url), 'utf8'));
  for (const key of schema.$defs.inputs.required) assert.ok(Object.hasOwn(next.inputs, key), key);
  assert.equal(next.inputs.negative_prompt, null); assert.equal(next.inputs.source_video, null);
  assert.equal(next.inputs.frames_or_refs, 'frames');
  assert.equal(!!next.inputs.first_frame, hasEndpoints); assert.equal(!!next.inputs.last_frame, hasEndpoints);
  assert.deepEqual(next.model, { id: 'fal:h3-i2v' });
  const canonical = withNextVideoDraft(cardMeta, { firstFrame: next.inputs.first_frame,
    lastFrame: next.inputs.last_frame, modelId: next.model.id, at: next.updated_at }).next;
  // plannedStillMeta additionally supplies the schema's optional mode:null.
  assert.deepEqual(next, { ...canonical, inputs: { ...canonical.inputs, mode: null } });
  assert.equal(next.output.duration_s, 4);
  assert.equal(f.paidCalls, 0);
  assert.equal(await readFile(join(root, 'edit.json'), 'utf8'), before, 'the RPC itself never edits the timeline');
});
