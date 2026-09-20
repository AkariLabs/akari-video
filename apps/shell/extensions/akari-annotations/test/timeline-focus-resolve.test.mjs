import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const text = readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');
const source = ts.createSourceFile('widget.ts', text, ts.ScriptTarget.Latest, true);
const widget = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariAnnotationsWidget');
const names = ['resolveFocusSelection', 'focusRangeFor', 'focusTimelineItem', 'pulseFocusedItem', 'applyFocusPulseClass',
  'seekTimelineOutput', 'setTimelineView', 'setTimelineToolMode', 'setTimelineSnapEnabled'];
const methodText = name => {
  const method = widget.members.find(member => member.name?.getText(source) === name);
  assert.ok(method, name);
  return method.getText(source);
};
const code = ts.transpileModule(`class Handler { ${names.map(methodText).join('\n')} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2021 },
}).outputText;
const durationDeclaration = source.statements.flatMap(node => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : [])
  .find(node => node.name.getText(source) === 'FOCUS_PULSE_DURATION_MS');
const duration = Number(durationDeclaration.initializer.getText(source));

function fixture() {
  let now = 100;
  const timers = [];
  const cleared = [];
  const fakeWindow = {
    setTimeout: (callback, delay) => {
      const timer = { id: timers.length + 1, callback, delay, cancelled: false };
      timers.push(timer);
      return timer.id;
    },
    clearTimeout: id => {
      cleared.push(id);
      const timer = timers.find(candidate => candidate.id === id);
      if (timer) timer.cancelled = true;
    },
  };
  const Handler = new Function('FOCUS_PULSE_DURATION_MS', 'Date', 'window', `${code}\nreturn Handler;`)(
    duration, { now: () => now }, fakeWindow);
  const context = new Handler();
  const calls = [];
  Object.assign(context, {
    cutItemIds: ['cut-a'], segments: [{ index: 0, tlStart: 5, tlEnd: 9 }],
    expandedTimelineTreeRows: [{ id: 'item-a', itemKind: 'video', trackId: 'locked', parentId: 'group', at: 20, duration: 30 }],
    overlays: [{ id: 'overlay-a', start: 3, duration: 6 }], layers: [{ id: 'layer-a', t: 4, duration: 7 }],
    captions: [{ id: 'caption-a', start: 1, end: 2 }],
    audioBgm: { id: 'bgm-a', t: 2, duration: 40 }, audioNarration: [{ id: 'narration-a', t: 12 }],
    audioSfx: [{ id: 'sfx-a', t: 13, duration: 2 }], playheadT: 11, viewStart: 10,
    captionRangeToOutputRanges: () => [[1, 2], [10, 12]],
    applySelection: selection => calls.push(['selection', selection]),
    requestSeek: async (...args) => calls.push(['seek', ...args]),
    visibleDuration: () => 10, totalDuration: () => 100, minViewDurationSeconds: () => 1,
    applyViewDuration: (...args) => calls.push(['view', ...args]),
    revealPreviewSelection: () => calls.push(['reveal']),
    setViewStart: value => calls.push(['start', value]),
    setToolMode: value => calls.push(['tool', value]), setSnapEnabled: value => calls.push(['snap', value]),
    selectionRenderKeys: selection => [`${selection.kind}:${selection.kind === 'cut' ? selection.index : selection.id}`],
  });
  return { context, calls, timers, cleared, advance: ms => { now += ms; } };
}

const cases = [
  ['cut-a', { kind: 'cut', index: 0 }, [5, 9]],
  ['item-a', { kind: 'item', id: 'item-a', itemKind: 'video', trackId: 'locked', parentId: 'group' }, [20, 50]],
  ['overlay-a', { kind: 'overlay', id: 'overlay-a' }, [3, 9]],
  ['layer-a', { kind: 'layer', id: 'layer-a' }, [4, 11]],
  ['caption-a', { kind: 'caption', id: 'caption-a' }, [10, 12]],
  ['bgm-a', { kind: 'audio', id: 'bgm-a' }, [2, 42]],
  ['narration-a', { kind: 'audio', id: 'narration-a' }, [12, 12]],
  ['sfx-a', { kind: 'audio', id: 'sfx-a' }, [13, 15]],
];
for (const [id, selection, range] of cases) {
  test(`resolves selection and output range for ${id}`, () => {
    const { context } = fixture();
    assert.deepEqual(context.resolveFocusSelection(id), selection);
    assert.deepEqual(context.focusRangeFor(selection), range);
  });
}

test('resolution uses cut then tree precedence and omits absent parents', () => {
  const { context } = fixture();
  context.expandedTimelineTreeRows.push({ id: 'cut-a' }, { id: 'overlay-a', itemKind: 'html', trackId: 'track' });
  assert.deepEqual(context.resolveFocusSelection('cut-a'), { kind: 'cut', index: 0 });
  assert.deepEqual(context.resolveFocusSelection('overlay-a'), { kind: 'item', id: 'overlay-a', itemKind: 'html', trackId: 'track' });
});

test('missing selections and ranges are harmless', async () => {
  const { context, calls } = fixture();
  assert.equal(await context.focusTimelineItem('missing', { seek: true, reveal: true, pulse: true }), false);
  assert.deepEqual(calls, []);
  for (const kind of ['cut', 'item', 'overlay', 'layer', 'caption', 'audio']) {
    assert.equal(context.focusRangeFor({ kind, id: 'missing', index: 99 }), undefined);
  }
});

test('caption fallback and optional background timing resolve deterministically', () => {
  const { context } = fixture();
  context.playheadT = 12;
  assert.deepEqual(context.focusRangeFor({ kind: 'caption', id: 'caption-a' }), [1, 2]);
  context.captionRangeToOutputRanges = () => [];
  assert.equal(context.focusRangeFor({ kind: 'caption', id: 'caption-a' }), undefined);
  context.audioBgm = { id: 'bgm-a' };
  assert.deepEqual(context.focusRangeFor({ kind: 'audio', id: 'bgm-a' }), [0, 0]);
});

test('focus seeks cut and tree starts and zooms only oversized ranges', async () => {
  for (const [id, , range] of cases) {
    const { context, calls } = fixture();
    assert.equal(await context.focusTimelineItem(id, { seek: true, reveal: true }), true);
    assert.deepEqual(calls.find(call => call[0] === 'seek'), ['seek', range[0], { domain: 'output' }]);
    const zoom = calls.find(call => call[0] === 'view');
    assert.equal(Boolean(zoom), range[1] - range[0] > 10);
    if (zoom) assert.deepEqual(zoom, ['view', (range[1] - range[0]) * 1.2, (range[0] + range[1]) / 2, 0.5]);
    assert.ok(calls.some(call => call[0] === 'reveal'));
  }
});

test('default focus only selects and equal-width ranges do not zoom', async () => {
  const { context, calls } = fixture();
  await context.focusTimelineItem('cut-a');
  assert.deepEqual(calls, [['selection', { kind: 'cut', index: 0 }]]);
  context.visibleDuration = () => 4;
  await context.focusTimelineItem('cut-a', { reveal: true });
  assert.equal(calls.some(call => call[0] === 'view'), false);
});

test('pulse marks only matching chips and expires after the configured duration', async () => {
  const { context, timers, advance } = fixture();
  const elements = ['0', '1'].map(id => ({
    dataset: { akariItemKind: 'cut', akariItemId: id },
    classList: { toggle(name, enabled) { this[name] = enabled; } },
  }));
  context.strip = { querySelectorAll: () => elements };
  await context.focusTimelineItem('cut-a', { pulse: true });
  assert.equal(duration, 1600);
  assert.equal(context.focusPulseUntil, 100 + duration);
  assert.deepEqual(elements.map(element => element.classList['akari-annotations-focus-pulse']), [true, false]);
  assert.equal(timers[0].delay, duration);
  advance(duration);
  if (!timers[0].cancelled) timers[0].callback();
  assert.equal(context.focusPulseUntil, 0);
  assert.deepEqual(elements.map(element => element.classList['akari-annotations-focus-pulse']), [false, false]);
});

test('a repeated pulse cancels the prior timer and gives the new item the full duration', () => {
  const { context, timers, cleared, advance } = fixture();
  const elements = ['0', '1'].map(id => ({
    dataset: { akariItemKind: 'cut', akariItemId: id },
    classList: { toggle(name, enabled) { this[name] = enabled; } },
  }));
  context.strip = { querySelectorAll: () => elements };
  context.pulseFocusedItem({ kind: 'cut', index: 0 });
  advance(500);
  context.pulseFocusedItem({ kind: 'cut', index: 1 });
  assert.deepEqual(cleared, [timers[0].id]);
  assert.equal(context.focusPulseUntil, 100 + 500 + duration);
  assert.deepEqual(elements.map(element => element.classList['akari-annotations-focus-pulse']), [false, true]);
  advance(duration - 500);
  if (!timers[0].cancelled) timers[0].callback();
  assert.deepEqual(elements.map(element => element.classList['akari-annotations-focus-pulse']), [false, true]);
  advance(500);
  if (!timers[1].cancelled) timers[1].callback();
  assert.equal(context.focusPulseUntil, 0);
  assert.deepEqual(elements.map(element => element.classList['akari-annotations-focus-pulse']), [false, false]);
});

test('widget disposal clears the active focus pulse timer', () => {
  const start = text.indexOf('if (this.visualThumbnailRetryTimer)');
  const end = text.indexOf('this.failedVisualThumbnails.clear();', start);
  assert.ok(start >= 0 && end > start);
  const disposal = text.slice(start, end);
  assert.match(disposal, /if \(this\.focusPulseTimer !== undefined\) window\.clearTimeout\(this\.focusPulseTimer\);/);
});

test('public wrappers preserve view anchors and validate seek timing', async () => {
  const { context, calls } = fixture();
  await context.seekTimelineOutput(NaN);
  await context.seekTimelineOutput(Infinity);
  assert.deepEqual(calls, []);
  await context.seekTimelineOutput(7);
  context.setTimelineView({ fit: true });
  context.setTimelineView({ durationSeconds: 6 });
  context.setTimelineView({ startSeconds: 3, durationSeconds: 8 });
  context.setTimelineView({ startSeconds: 4 });
  context.setTimelineView({ startSeconds: NaN, durationSeconds: -1 });
  context.setTimelineToolMode('razor');
  context.setTimelineSnapEnabled(false);
  assert.deepEqual(calls, [['seek', 7, { domain: 'output' }], ['view', 100, 0, 0],
    ['view', 6, 12, 0], ['view', 8, 3, 0], ['start', 4], ['tool', 'razor'], ['snap', false]]);
});
