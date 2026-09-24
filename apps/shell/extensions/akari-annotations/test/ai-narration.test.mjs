import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { aiActionCatalog, describeAiTiles } from '../lib/common/ai-action-catalog.js';
import { aiNarrationSourcePath, planAiNarrationPlacement } from '../lib/common/ai-narration-placement.js';
import { generateAiNarration } from '../lib/browser/inspector/ai-narration-panel.js';
import { resolveAiTranscribeTarget } from '../lib/browser/inspector/ai-transcribe-panel.js';
import { aiTargetKindFor } from '../lib/browser/inspector/ai-tiles.js';
import * as mutations from '../lib/common/edit-v2-mutations.js';
import { AkariEditHistoryService } from '../lib/browser/akari-edit-history-service.js';

const engine = { id: 'voicevox', label: 'VOICEVOX', place: 'local',
  price: { usd_per_1000_chars: 0, verified: true },
  availability: { state: 'available', label: '使える' } };
const paid = { id: 'gemini-tts', label: 'Gemini TTS', place: 'cloud',
  price: { usd_per_1000_chars: 0.1, verified: true, as_of: '2026-09-23' },
  availability: { state: 'available', label: '使える' } };
const clip = (id, at, duration) => ({ id, at, duration,
  source: { kind: 'media', src: `${id}-src`, in: 0, out: duration / 30 } });
const fixture = (following = [], lower = []) => ({ version: 2, output: { fps: 30 },
  sources: [{ id: 'frame-src', path: 'assets/generated/frame.wav' }], tracks: [
    ...lower.map((items, index) => ({ id: `lower-${index}`, lane: 'audio', items })),
    { id: 'frame-track', lane: 'audio', items: [clip('frame', 30, 60), ...following] },
    { id: 'visual', lane: 'visual', items: [] }
  ] });

test('カタログ: 音の空の枠だけ押せる・入った音声は理由付き・エンジン無しでは行が出ない', () => {
  const catalog = aiActionCatalog([], [engine, paid, { ...engine, id: 'unused' }]);
  const row = catalog.find(action => action.id === 'narration');
  assert.deepEqual([row.group, row.output, row.placement, row.image], ['make', 'audio', 'replace', 'narration']);
  assert.deepEqual(row.routes.map(route => [route.id, route.cost]), [['voicevox', 'free'], ['gemini-tts', 'paid']]);
  assert.equal(describeAiTiles(catalog, 'empty-audio-frame')[0].tiles[0].enabled, true);
  const filled = describeAiTiles(catalog, 'audio')[0].tiles[0];
  assert.equal(filled.enabled, false);
  assert.equal(filled.reason, '空いている音声の枠で使えます');
  assert.equal(describeAiTiles(aiActionCatalog([], []), 'empty-audio-frame').some(group =>
    group.tiles.some(tile => tile.id === 'narration')), false);
});

test('置き場: 短い・同段延長・下段・さらに下・新しい最下段', () => {
  const cases = [
    [fixture(), 1.5, 'replace', 'frame-track', 45],
    [fixture(), 3.5, 'extend', 'frame-track', 105],
    [fixture([clip('after', 105, 30)], [[]]), 3.5, 'lower-track', 'lower-0', 105],
    [fixture([clip('after', 105, 30)], [[], [clip('busy', 30, 120)]]), 3.5, 'lower-track', 'lower-0', 105],
    [fixture([clip('after', 105, 30)], [[clip('busy', 30, 120)]]), 3.5, 'new-track', '', 105]
  ];
  for (const [doc, seconds, mode, trackId, frames] of cases) {
    const result = planAiNarrationPlacement(doc.tracks, 'frame', seconds, 30);
    assert.deepEqual([result.mode, result.trackId, result.at, result.durationFrames], [mode, trackId, 30, frames]);
  }
  const twoLower = fixture([clip('after', 105, 30)], [[clip('busy-low', 30, 120)], []]);
  assert.equal(planAiNarrationPlacement(twoLower.tracks, 'frame', 3.5, 30).trackId, 'lower-1');
});

test('fps 30 / 24 では秒を整数フレームに切り上げる', () => {
  for (const fps of [30, 24]) {
    const doc = fixture();
    const result = planAiNarrationPlacement(doc.tracks, 'frame', 1.51, fps);
    assert.equal(result.durationFrames, Math.ceil(1.51 * fps));
    assert.equal(Number.isInteger(result.durationFrames), true);
  }
});

test('生成失敗は編集不変・有料の承認拒否は生成 0 回', async () => {
  const doc = fixture(); const original = structuredClone(doc);
  let calls = 0; let edits = 0;
  const state = { script: 'こんにちは', reading: '', engineId: paid.id, voiceId: 'voice', voices: [], running: false };
  const base = { state, engine: paid, projectRootUri: 'file:///tmp/project', itemId: 'frame', atSeconds: 1,
    service: { generateNarration: async () => { calls++; throw new Error('生成失敗'); } },
    confirm: async () => false, commit: async () => { edits++; }, fps: 30 };
  assert.equal(await generateAiNarration(base), undefined);
  assert.deepEqual([calls, edits], [0, 0]);
  await assert.rejects(generateAiNarration({ ...base, confirm: async () => true }), /生成失敗/u);
  assert.deepEqual([calls, edits], [1, 0]);
  assert.deepEqual(doc, original);
});

test('彩の生成には呼び出し元の接続先を渡す', async () => {
  const state = { script: 'こんにちは', reading: '', engineId: 'irodori', voiceId: 'speaker',
    voices: [], running: false };
  let request;
  await generateAiNarration({ state, engine: { id: 'irodori', label: '彩', place: 'network',
    availability: { state: 'available', label: '使える' } },
  projectRootUri: 'file:///tmp/project', itemId: 'frame', atSeconds: 1, fps: 30,
  irodoriUrl: 'http://other-pc:9000', confirm: async () => { throw new Error('無料で承認は不要'); },
  service: { generateNarration: async value => { request = value;
    return { status: 'ok', path: 'out/narration/n-0001.wav', duration_s: 1.5 }; } },
  commit: async (_, mutate) => { mutate(fixture()); } });
  assert.equal(request.irodoriUrl, 'http://other-pc:9000');
});

test('widget: 同じ item の素材が undo / redo で変わると planned と置き先表示を更新する', async () => {
  const source = readFileSync(new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('widget.ts', source, ts.ScriptTarget.Latest, true);
  const klass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariInspectorWidget');
  const method = name => klass.members.find(node => node.name?.getText(ast) === name).getText(ast);
  const compiled = ts.transpileModule(`class Harness {
    ${method('loadAiTranscribeTarget')}
    ${method('verifyAiNarrationSource')}
  }`, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
  const Harness = new Function('aiNarrationSourcePath', 'resolveAiTranscribeTarget',
    `${compiled}; return Harness;`)(aiNarrationSourcePath, resolveAiTranscribeTarget);
  const snapshot = { kind: 'audio', id: 'frame', audioKind: 'sfx', label: 'frame.wav', outputStart: 1, duration: 2 };
  const empty = fixture();
  const generated = structuredClone(empty);
  generated.sources.push({ id: 'voice-src', path: 'out/narration/n-0001.wav' });
  generated.tracks[0].items[0].source.src = 'voice-src';
  let doc = generated;
  const widget = Object.assign(new Harness(), {
    transcribeKey: 'frame-key', aiViewClipKey: 'clip-key', narrationSourcePath: 'out/narration/n-0001.wav',
    narrationSourceCheckVersion: 0, audioPlanned: false, isDisposed: false,
    narrationPlacementNotice: { clipKey: 'clip-key', sourcePath: 'out/narration/n-0001.wav', label: 'A1 に置きました' },
    narrationStates: new Map([['clip-key', { placement: 'A1 に置きました' }]]),
    workspaceService: { ready: Promise.resolve(), tryGetRoots: () => [{ resource: {
      toString: () => 'file:///fixture', resolve: name => name } }] },
    fileService: { readFile: async () => ({ value: Buffer.from(JSON.stringify(doc)) }), exists: async () => true },
    layerAudioService: { readTranscriptSummary: async () => ({ state: 'none', segments: [], total: 0 }),
      readGenerationSidecars: async () => ({ entries: doc === empty
        ? [{ sourcePath: 'assets/generated/frame.wav', meta: { kind: 'audio', status: 'planned' } }] : [] }) },
    render() {
      if (this.transcribeKey === undefined) {
        this.transcribeKey = 'frame-key';
        this.reloaded = this.loadAiTranscribeTarget(snapshot, 'frame-key');
      }
    }
  });
  const tile = () => describeAiTiles(aiActionCatalog([], [engine]),
    aiTargetKindFor({ hasIdentity: false, audio: true, audioPlanned: widget.audioPlanned }))[0].tiles[0];
  assert.equal(tile().enabled, false);
  doc = empty;
  widget.narrationEditVersion = 1;
  await widget.verifyAiNarrationSource(snapshot, 'frame-key');
  await widget.reloaded;
  assert.equal(widget.narrationSourcePath, 'assets/generated/frame.wav');
  assert.equal(tile().enabled, true);
  assert.equal(widget.narrationPlacementNotice, undefined);
  assert.equal(widget.narrationStates.get('clip-key').placement, undefined);
  doc = generated;
  widget.narrationEditVersion = 2;
  await widget.verifyAiNarrationSource(snapshot, 'frame-key');
  await widget.reloaded;
  assert.equal(widget.narrationSourcePath, 'out/narration/n-0001.wav');
  assert.equal(tile().enabled, false);
  assert.equal(widget.narrationPlacementNotice, undefined);
});

test('widget: 音声選択が残っていても素材表示中は edit.json の変更で描き直さない', () => {
  const source = readFileSync(new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('widget.ts', source, ts.ScriptTarget.Latest, true);
  const klass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariInspectorWidget');
  const method = name => klass.members.find(node => node.name?.getText(ast) === name).getText(ast);
  let callback;
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'this.fileService.onDidFilesChange'
      && node.arguments[0].getText(ast).includes('this.narrationEditVersion')) {
      callback = node.arguments[0].getText(ast);
    }
    ts.forEachChild(node, visit);
  };
  visit(klass.members.find(node => node.name?.getText(ast) === 'init'));
  assert.ok(callback, 'edit.json の変更を監視する callback を抽出できる');
  const compiled = ts.transpileModule(`class Harness {
    ${method('selectMaterial')}
    wireEdit() { this.fileService.onDidFilesChange(${callback}); }
  }`, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
  const Harness = new Function(`${compiled}; return Harness;`)();
  const editUri = { toString: () => 'file:///fixture/edit.json' };
  let onFilesChanged;
  let renders = 0;
  const widget = Object.assign(new Harness(), {
    model: { snapshot: { kind: 'audio', id: 'previous-audio' } },
    workspaceService: { tryGetRoots: () => [{ resource: { resolve: name => name === 'edit.json' ? editUri : undefined } }] },
    fileService: { onDidFilesChange: callback => { onFilesChanged = callback; } },
    render: () => { renders++; }
  });
  widget.wireEdit();
  widget.selectMaterial({ kind: 'material', projectRoot: 'file:///fixture', relativePath: 'assets/still.png',
    mediaKind: 'image', name: 'still.png' });
  assert.equal(widget.model.snapshot.kind, 'audio', '素材選択は直前の音声 snapshot を残す');
  assert.equal(renders, 1);
  onFilesChanged({ changes: [{ resource: editUri }] });
  assert.equal(renders, 1, '素材表示中の edit.json 変更は描き直さない');
  widget.materialSelection = undefined;
  onFilesChanged({ changes: [{ resource: editUri }] });
  assert.equal(renders, 2, '音声表示へ戻ると edit.json 変更を監視する');
});

const timelineSource = readFileSync(new URL('../lib/browser/akari-annotations-widget.js', import.meta.url), 'utf8');
function timelineMethod(name) {
  const start = timelineSource.search(new RegExp(`    (async )?${name}\\(`));
  assert.notEqual(start, -1, name);
  const rest = timelineSource.slice(start);
  return rest.slice(0, rest.indexOf('\n    }') + 6);
}
// Extract the production mutation methods; full widget construction requires Theia's DOM and DI container.
const Timeline = new Function('edit_v2_mutations_1', `return class {
  ${timelineMethod('commitEditMutation')}
  ${timelineMethod('performEditMutation')}
  ${timelineMethod('frameAt')}
}`)(mutations);

test('本物の commitEditMutation は replace / lower-track / new-track を 1 手で置き、undo 1 回で戻す', async () => {
  const cases = [
    { name: 'replace', initial: fixture(), seconds: 1.5, expectedTrack: 'frame-track', expectedTracks: 2 },
    { name: 'lower-track', initial: fixture([clip('after', 105, 30)], [[]]), seconds: 3.5,
      expectedTrack: 'lower-0', expectedTracks: 3 },
    { name: 'new-track', initial: fixture([clip('after', 105, 30)]), seconds: 3.5,
      expectedTrack: undefined, expectedTracks: 3 }
  ];
  for (const { name, initial, seconds, expectedTrack, expectedTracks } of cases) {
    let disk = mutations.stringifyEditV2(initial);
    const history = new AkariEditHistoryService();
    const labels = [];
    const timeline = Object.assign(new Timeline(), {
      editMutationTail: Promise.resolve(), fps: 30, contentEndDuration: () => 0,
      location: { editUri: 'edit' }, historyService: history,
      fileService: { readFile: async () => ({ value: disk }) },
      prepareMotionChanges: async () => [], writeMotionChanges: async () => {},
      reloadEdit: async () => {}, reloadCaptions: async () => {},
      writeEditSnapshotGuarded: async source => { disk = source; },
      pushHistory: entry => { labels.push(entry.label); history.push(entry); }
    });
    const state = { script: 'こんにちは', reading: '', engineId: engine.id, voiceId: 'voice', voices: [], running: false };
    const label = await generateAiNarration({ state, engine, projectRootUri: 'file:///tmp/project',
      itemId: 'frame', atSeconds: 1, fps: 30, confirm: async () => { throw new Error('無料で承認は不要'); },
      service: { generateNarration: async request => {
        assert.equal(request.captionId, null); assert.equal(request.t, 1);
        return { status: 'ok', path: 'out/narration/n-0001.wav', duration_s: seconds };
      } },
      commit: (title, mutate) => timeline.commitEditMutation(title, mutate) });
    assert.deepEqual(labels, ['ナレーションを置く'], name);
    assert.equal(history.canUndo, true, name);
    assert.match(label, /A\d+ に置きました/u);
    const current = JSON.parse(disk);
    assert.equal(current.tracks.length, expectedTracks, name);
    const destination = current.tracks.find(track => track.items.some(item => item.id === 'frame'));
    if (expectedTrack) assert.equal(destination.id, expectedTrack, name);
    else assert.equal(destination.id, current.tracks[0].id, name);
    const placed = destination.items.find(item => item.id === 'frame');
    assert.equal(placed.source.src, 'narration-src-1');
    assert.equal(current.sources.at(-1).path, 'out/narration/n-0001.wav');
    if (seconds > 2) assert.equal(current.tracks.find(track => track.id === 'frame-track')
      .items.find(item => item.id === 'after').at, 105, name);
    await history.undo();
    assert.equal(history.canUndo, false, name);
    assert.deepEqual(JSON.parse(disk), initial, `${name}: one undo restores frame and removes any new track`);
  }
});
