import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { applyAdjustBypass } from '../lib/common/adjust-bypass.js';

for (const fn of [applyAdjustBypass, new Function('return (' + applyAdjustBypass.toString() + ')')()]) {
  test('adjust bypass removes only target adjustment and preserves raw summary', () => {
    const item = { id: 'a', adjust: { basic: { exposure: 1 } }, opacity: 0.5 };
    const other = { id: 'b', adjust: { lut: { lut: 'natural' } } };
    const summary = { cuts: [item, other], layers: [item], filters: [item], output: { fps: 30 } };
    const result = fn(summary, ['a']);
    for (const key of ['cuts', 'layers', 'filters']) assert.deepEqual(result[key][0], { id: 'a', opacity: 0.5 });
    assert.equal(result.cuts[1], other);
    assert.equal(result.output, summary.output);
    assert.ok(item.adjust);
    assert.equal(fn(summary, []), summary);
    assert.equal(fn(summary, ['missing']), summary);
    assert.equal(fn(result, ['a']), result);
  });
}
test('A/B event, engine projection and DOM bypass are connected', () => {
  const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
  assert.match(source, /TIMELINE_ADJUST_BYPASS_EVENT = 'akari.timeline.adjustBypass'/u);
  assert.match(source, /const onAdjustBypass[\s\S]+type: 'akari-preview-adjust-bypass'/u);
  assert.match(source, /removeEventListener\(TIMELINE_ADJUST_BYPASS_EVENT, onAdjustBypass\)/u);
  assert.ok(source.includes('${applyAdjustBypass.toString()}'));
  assert.match(source, /message.type === 'akari-preview-adjust-bypass'[\s\S]+adjustBypassIds.add\(String\(id\)\)[\s\S]+adjustBypassIds.delete\(String\(id\)\)/u);
  assert.match(source, /effectiveSummary = applyAdjustBypassFn\(nextSummary, \[\.\.\.adjustBypassIds\]\)/u);
  assert.match(source, /engineSummary = nextSummary/u);
  assert.match(source, /refreshAdjustBypass\(\)[\s\S]+queueEngineSummaryUpdate\(current => current, false\)/u);
  assert.match(source, /computeAdjustCssVisualFn\(adjustOfItem\(item\)/u);
  assert.match(source, /const adjust = adjustOfItem\(segment\)/u);
  const handler = source.slice(source.indexOf("if (message && message.type === 'akari-preview-adjust-bypass'"));
  assert.match(handler, /setAdjustBaseFilter\(entry.video, entry.spec\)/u);
  assert.match(handler, /setAdjustBaseFilter\(entry.element, entry.spec\)/u);
});

test('A/B widget state seeds both webview scripts across setHTML and edit changes', () => {
  const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
  const compiled = readFileSync(new URL('../lib/browser/akari-preview-open-handler.js', import.meta.url), 'utf8');
  assert.match(source, /akariPreviewAdjustBypassIds\?: Set<string>/u);
  const handler = source.slice(source.indexOf('const onAdjustBypass'), source.indexOf('window.addEventListener(TIMELINE_ADJUST_BYPASS_EVENT'));
  assert.ok(handler.indexOf('ids.add(String(id))') < handler.indexOf('widget.sendMessage'));
  assert.match(handler, /else ids.delete\(String\(id\)\)/u);
  const compiledHandler = compiled.slice(compiled.indexOf('const onAdjustBypass'));
  const update = compiledHandler.match(/if \(widget\) \{([\s\S]*?)\n            \}/u);
  assert.ok(update);
  const updateWidget = new Function('widget', 'detail', update[1]);
  const widget = { akariPreviewSummary: { cuts: [{ id: 'cut-a' }, { id: 'cut-b' }] } };
  for (const target of [{ kind: 'cut', index: 1 }, { kind: 'item', id: 'item-a' }, { kind: 'layer', id: 'layer-a' }]) {
    updateWidget(widget, { target, enabled: true });
    updateWidget(widget, { target, enabled: true });
  }
  assert.deepEqual([...widget.akariPreviewAdjustBypassIds], ['cut-b', 'item-a', 'layer-a']);
  const messageId = source.match(/const id = target.kind === 'cut' \? summary.cuts\?\.\[target.index\]\?\.id\s*: target.kind === 'item' \|\| target.kind === 'layer' \? target.id : undefined;/u);
  assert.ok(messageId);
  const resolveWebviewId = new Function('summary', 'target', messageId[0] + '\nreturn id;');
  assert.equal(resolveWebviewId(widget.akariPreviewSummary, { kind: 'cut', index: 1 }), 'cut-b');
  const sessionBlock = source.slice(source.indexOf('model.session = {'));
  const sessionValue = sessionBlock.match(/adjustBypassIds: (\[\.\.\.\(widget.akariPreviewAdjustBypassIds \?\? \[\]\)\])/u);
  assert.ok(sessionValue);
  const seedSession = new Function('widget', 'return ' + sessionValue[1]);
  const optionValue = source.match(/adjustBypassIds: (model.session\?\.adjustBypassIds \?\? \[\])/u);
  assert.ok(optionValue);
  const seedOptions = new Function('model', 'return ' + optionValue[1]);
  assert.match(source, /widget.setHTML\(this.prepareHtml\([\s\S]*?\bmodel,/u);
  const declarations = [...source.matchAll(/const adjustBypassIds = window.akari.adjustBypassIds \|\| \(window.akari.adjustBypassIds = new Set\(initial.adjustBypassIds \|\| \[\]\)\);/gu)];
  assert.equal(declarations.length, 2);
  const bootstrap = declarations.map(([code]) => new Function('window', 'initial', code + '\nreturn adjustBypassIds;'));
  for (const order of [bootstrap, [...bootstrap].reverse()]) {
    const window = { akari: {} };
    const initial = { adjustBypassIds: seedOptions({ session: { adjustBypassIds: seedSession(widget) } }) };
    const first = order[0](window, initial);
    assert.deepEqual([...first], ['cut-b', 'item-a', 'layer-a']);
    first.add('during-mount');
    assert.equal(order[1](window, initial), first);
  }
  widget.akariPreviewSummary = { cuts: [{ id: 'cut-b' }] };
  assert.deepEqual(seedSession(widget), ['cut-b', 'item-a', 'layer-a']);
  updateWidget(widget, { target: { kind: 'cut', index: 0 }, enabled: false });
  updateWidget(widget, { target: { kind: 'item', id: 'item-a' }, enabled: false });
  updateWidget(widget, { target: { kind: 'layer', id: 'layer-a' }, enabled: false });
  assert.deepEqual(seedSession(widget), []);
});
