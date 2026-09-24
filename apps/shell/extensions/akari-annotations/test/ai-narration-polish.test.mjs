import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';

import test from 'node:test';

import ts from 'typescript';

import { aiActionCatalog } from '../lib/common/ai-action-catalog.js';

import { aiNarrationNeedsChoice, aiNarrationSourcePath, planAiNarrationPlacement,
  placeAiNarration } from '../lib/common/ai-narration-placement.js';

import { aiNarrationChoiceVisible, generateAiNarration } from '../lib/browser/inspector/ai-narration-panel.js';

import * as mutations from '../lib/common/edit-v2-mutations.js';

import { AkariEditHistoryService } from '../lib/browser/akari-edit-history-service.js';

const engine = { id: 'voicevox', label: 'VOICEVOX', place: 'local',
  price: { usd_per_1000_chars: 0, verified: true },
  availability: { state: 'available', label: '使える' } };

const paid = { id: 'gemini-tts', label: 'Gemini TTS', place: 'cloud',
  price: { usd_per_1000_chars: 0.1, verified: true, as_of: '2026-09-23' },
  availability: { state: 'available', label: '使える' } };

const ownVoice = { ...paid, id: 'fal-qwen3', label: 'fal Qwen3-TTS',
  price: { usd_per_1000_chars: 0.2, verified: true, as_of: '2026-09-24' } };

const clip = (id, at, duration) => ({ id, at, duration,
  source: { kind: 'media', src: `${id}-src`, in: 0, out: duration / 30 } });

const fixture = (following = [], lower = []) => ({ version: 2, output: { fps: 30 },
  sources: [{ id: 'frame-src', path: 'assets/generated/frame.wav' }], tracks: [
    ...lower.map((items, index) => ({ id: `lower-${index}`, lane: 'audio', items })),
    { id: 'frame-track', lane: 'audio', items: [clip('frame', 30, 60), ...following] },
    { id: 'visual', lane: 'visual', items: [] }
  ] });

test('ずらす選択は後ろに重なるときだけ必要で、実際に重ならなければ無視する', () => {
  const cases = [
    { following: [], seconds: 3.5, choice: false, mode: 'extend' },
    { following: [clip('after', 105, 30)], seconds: 1.5, choice: false, mode: 'replace' },
    { following: [clip('after', 150, 30)], seconds: 3.5, choice: false, mode: 'extend' },
    { following: [clip('after', 105, 30)], seconds: 3.5, choice: true, mode: 'shift' }
  ];
  for (const row of cases) {
    const doc = fixture(row.following);
    assert.equal(aiNarrationNeedsChoice(doc.tracks, 'frame', row.seconds, 30), row.choice);
    assert.equal(planAiNarrationPlacement(doc.tracks, 'frame', row.seconds, 30, 'shift').mode, row.mode);
  }
  const doc = fixture([clip('after', 105, 30), clip('later', 210, 30)], [[clip('other', 105, 30)]]);
  const placed = placeAiNarration(doc, 'frame', 'out/narration/n-0001.wav', 3.5, 30, 'shift');
  assert.deepEqual(placed.tracks.find(track => track.id === 'frame-track').items.map(item => [item.id, item.at]),
    [['frame', 30], ['after', 150], ['later', 255]]);
  assert.deepEqual(placed.tracks.find(track => track.id === 'lower-0'), doc.tracks.find(track => track.id === 'lower-0'));
  assert.deepEqual(doc.tracks.find(track => track.id === 'frame-track').items.map(item => item.at), [30, 105, 210]);
});

test('生成前の 2 択は原稿の推定秒数で重なるときだけ表示する', () => {
  const doc = fixture([clip('after', 105, 30)]);
  const placement = { tracks: doc.tracks, itemId: 'frame', fps: 30 };
  assert.equal(aiNarrationChoiceVisible({ script: '', reading: '' }, placement), false);
  assert.equal(aiNarrationChoiceVisible({ script: '短い', reading: '' }, placement), false);
  assert.equal(aiNarrationChoiceVisible({ script: '長い原稿です。後ろのクリップに重なる長さです。', reading: '' }, placement), true);
  assert.equal(aiNarrationChoiceVisible({ script: '長い原稿です。', reading: '短い' }, placement), false);
  assert.equal(aiNarrationChoiceVisible({ script: '長い原稿です。', reading: '' }), false);
});

test('自声は available のときだけ AI カタログに有料で現れる', () => {
  for (const availability of ['available', 'unconfigured', 'needs']) {
    const row = aiActionCatalog([], [engine, { ...ownVoice, availability: { state: availability, label: availability } }])
      .find(action => action.id === 'narration');
    const route = row.routes.find(item => item.id === 'fal-qwen3');
    assert.equal(!!route, availability === 'available');
    if (route) assert.deepEqual([route.cost, route.label], ['paid', '自声 · 有料 · $0.2 / 1000 字']);
  }
});

test('自声の費用承認を断ると生成しない', async () => {
  let generated = 0;
  let message;
  const state = { script: '自分の声です', reading: '', engineId: ownVoice.id,
    voiceId: 'self', voices: [], running: false };
  await generateAiNarration({ state, engine: ownVoice, projectRootUri: 'file:///tmp/project', itemId: 'frame',
    atSeconds: 1, fps: 30, confirm: async value => { message = value; return false; },
    service: { generateNarration: async () => { generated++; throw new Error('unexpected'); } },
    commit: async () => { throw new Error('unexpected'); } });
  assert.match(message.msg, /\$0\.001.*6 字/u);
  assert.equal(generated, 0);
});

test('自声の費用承認後は選んだ声の id を profile として 1 回だけ送る', async () => {
  const state = { script: '自分の声です', reading: '', engineId: ownVoice.id,
    voiceId: 'self', voices: [{ id: 'self', label: '自声プロファイル' }], running: false };
  const requests = [];
  let approvals = 0;
  let commits = 0;
  await generateAiNarration({ state, engine: ownVoice, projectRootUri: 'file:///tmp/project', itemId: 'frame',
    atSeconds: 1, fps: 30, confirm: async () => { approvals++; return true; },
    service: { generateNarration: async request => {
      requests.push(request);
      return { status: 'ok', path: 'out/narration/n-0001.wav', duration_s: 1.5 };
    } },
    commit: async (_, mutate) => { commits++; mutate(fixture()); } });
  assert.equal(approvals, 1);
  assert.equal(commits, 1);
  assert.equal(requests.length, 1);
  assert.deepEqual([requests[0].engine, requests[0].approved, requests[0].profile],
    ['fal-qwen3', true, 'self']);
});

test('widget: 同じ item と edit 版の render を重ねても readFile せず、変更後だけ 1 回読む', async () => {
  const source = readFileSync(new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('widget.ts', source, ts.ScriptTarget.Latest, true);
  const klass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariInspectorWidget');
  const method = klass.members.find(node => node.name?.getText(ast) === 'verifyAiNarrationSource').getText(ast);
  let callback;
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'this.fileService.onDidFilesChange'
      && node.arguments[0].getText(ast).includes('this.narrationEditVersion')) callback = node.arguments[0].getText(ast);
    ts.forEachChild(node, visit);
  };
  visit(klass.members.find(node => node.name?.getText(ast) === 'init'));
  assert.ok(callback);
  const compiled = ts.transpileModule(`class Harness { ${method}
    wireEdit() { this.fileService.onDidFilesChange(${callback}); }
  }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
  const Harness = new Function('aiNarrationSourcePath', `${compiled}; return Harness;`)(aiNarrationSourcePath);
  const doc = fixture();
  let reads = 0;
  let onFilesChanged;
  const snapshot = { kind: 'audio', id: 'frame' };
  const widget = Object.assign(new Harness(), {
    transcribeKey: 'frame-key', narrationSourcePath: 'assets/generated/frame.wav',
    narrationSourceCheckVersion: 0, narrationEditVersion: 0, aiView: 'tiles', isDisposed: false,
    model: { snapshot },
    workspaceService: { tryGetRoots: () => [{ resource: { resolve: name => name } }] },
    fileService: { readFile: async () => { reads++; return { value: Buffer.from(JSON.stringify(doc)) }; },
      onDidFilesChange: callback => { onFilesChanged = callback; } },
    render() { this.pendingRender = this.verifyAiNarrationSource(snapshot, 'frame-key'); return this.pendingRender; }
  });
  widget.wireEdit();
  await widget.render();
  assert.equal(reads, 1);
  for (let n = 0; n < 20; n++) await widget.render();
  assert.equal(reads, 1);
  onFilesChanged({ changes: [{ resource: { toString: () => 'edit.json' } }] });
  await widget.pendingRender;
  assert.equal(reads, 2);
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

test('本物の commitEditMutation は shift を 1 手で置き、undo 1 回で戻す', async () => {
  const initial = fixture([clip('after', 105, 30), clip('later', 210, 30)], [[clip('other', 105, 30)]]);
  let disk = mutations.stringifyEditV2(initial);
  const history = new AkariEditHistoryService();
  const labels = [];
  const timeline = Object.assign(new Timeline(), {
    editMutationTail: Promise.resolve(), fps: 30, contentEndDuration: () => 0,
    location: { editUri: 'edit' }, historyService: history,
    fileService: { readFile: async () => ({ value: disk }) },
    prepareMotionChanges: async () => [], writeMotionChanges: async () => {},
    reloadEdit: async () => {}, reloadCaptions: async () => {},
    writeEditSnapshotGuarded: async value => { disk = value; },
    pushHistory: entry => { labels.push(entry.label); history.push(entry); }
  });
  await timeline.commitEditMutation('ナレーションを置く', doc =>
    placeAiNarration(doc, 'frame', 'out/narration/n-0001.wav', 3.5, 30, 'shift'));
  assert.deepEqual(labels, ['ナレーションを置く']);
  const changed = JSON.parse(disk);
  assert.equal(changed.tracks.find(track => track.id === 'frame-track').items.find(item => item.id === 'after').at, 150);
  assert.equal(changed.tracks.find(track => track.id === 'frame-track').items.find(item => item.id === 'later').at, 255);
  assert.deepEqual(changed.tracks.find(track => track.id === 'lower-0'), initial.tracks[0]);
  assert.equal(changed.tracks.find(track => track.id === 'frame-track').items.find(item => item.id === 'frame').duration, 105);
  await history.undo();
  assert.equal(history.canUndo, false);
  assert.deepEqual(JSON.parse(disk), initial);
});
