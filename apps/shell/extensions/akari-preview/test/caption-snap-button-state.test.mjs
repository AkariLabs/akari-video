import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readHandlerSource } from './helpers/handler-source.mjs';

const source = readHandlerSource();

test('caption snap starts pressed and shows the existing orange focus token while on', () => {
  assert.match(source, /data-caption-tool="snap" class="on" aria-label="吸着" aria-pressed="true"/);
  assert.match(source, /#caption-select-box \[data-caption-tool="snap"\]\.on \{ box-shadow: inset 0 0 0 2px var\(--akari-focus-pulse\); \}/);
  assert.match(source, /--akari-focus-pulse:\s*#f97316/);
  assert.match(source, /let captionSnapEnabled = true;/);
});

test('caption snap updates its pressed state with its on class', () => {
  const start = source.indexOf('const updateCaptionSelectTools =');
  const end = source.indexOf('const updateCaptionSelectBoxForRect =', start);
  assert.ok(start >= 0 && end > start);
  const state = { snap: { classes: new Set(), attributes: new Map() } };
  const tool = name => {
    const entry = state[name] ??= { classes: new Set(), attributes: new Map() };
    return {
      classList: { toggle: (key, value) => value ? entry.classes.add(key) : entry.classes.delete(key) },
      setAttribute: (key, value) => entry.attributes.set(key, value),
      style: { setProperty() {} },
    };
  };
  const context = vm.createContext({
    selectedCaptionId: null, captionSnapEnabled: true, captionGroupToolEnabled: false,
    captionDragGroupActive: false, captionClampChip: tool('clamp'), captionTool: tool,
    captionPositionReset: {}, selectedCaption: () => null, captionClampEnabled: () => false,
    captionHasCuePosition: () => false, setCaptionToolTip() {},
  });
  vm.runInContext(source.slice(start, end), context);
  vm.runInContext('updateCaptionSelectTools()', context);
  assert.ok(state.snap.classes.has('on'));
  assert.equal(state.snap.attributes.get('aria-pressed'), 'true');
  vm.runInContext('captionSnapEnabled = false; updateCaptionSelectTools()', context);
  assert.ok(!state.snap.classes.has('on'));
  assert.equal(state.snap.attributes.get('aria-pressed'), 'false');
});
