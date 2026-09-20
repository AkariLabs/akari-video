import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const text = readFileSync(new URL('../src/browser/akari-timeline-focus-contribution.ts', import.meta.url), 'utf8');
const source = ts.createSourceFile('contribution.ts', text, ts.ScriptTarget.Latest, true);
const code = ts.transpileModule(text, {
  compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS, experimentalDecorators: true },
}).outputText;
class AkariAnnotationsWidget {
  static FACTORY_ID = 'test-timeline';
  isAttached = true;
  isDisposed = false;
  calls = [];
  async focusTimelineItem(...args) { this.calls.push(['focus', ...args]); return true; }
  async seekTimelineOutput(...args) { this.calls.push(['seek', ...args]); }
  setTimelineView(...args) { this.calls.push(['view', ...args]); }
  setTimelineToolMode(...args) { this.calls.push(['tool', ...args]); }
  setTimelineSnapEnabled(...args) { this.calls.push(['snap', ...args]); }
}
const exports = {};
new Function('require', 'exports', code)(name => {
  if (name === '@theia/core/shared/inversify') return { inject: () => () => {}, injectable: () => target => target };
  if (name === '@theia/core/lib/common') return {};
  if (name === '@theia/core/lib/browser') return { ApplicationShell: class {}, WidgetManager: class {} };
  if (name === './akari-annotations-widget') return { AkariAnnotationsWidget };
  throw new Error(`Unexpected import: ${name}`);
}, exports);
const { AkariTimelineFocusContribution } = exports;
const commands = [
  ['FOCUS_TIMELINE_ITEM', 'akari.timeline.focusItem', 'focusTimelineItem', { itemId: 'clip', seek: true, reveal: true, pulse: true }],
  ['TIMELINE_SEEK', 'akari.timeline.seek', 'seekTimelineOutput', { seconds: 3 }],
  ['TIMELINE_SET_VIEW', 'akari.timeline.setView', 'setTimelineView', { startSeconds: 4, durationSeconds: 8, fit: true }],
  ['TIMELINE_SET_TOOL', 'akari.timeline.setTool', 'setTimelineToolMode', { tool: 'razor' }],
  ['TIMELINE_SET_SNAP', 'akari.timeline.setSnap', 'setTimelineSnapEnabled', { enabled: false }],
];
function fixture(widgets = [new AkariAnnotationsWidget()], activeWidget = undefined) {
  const contribution = new AkariTimelineFocusContribution();
  contribution.widgetManager = { getWidgets: id => { assert.equal(id, AkariAnnotationsWidget.FACTORY_ID); return widgets; } };
  contribution.shell = { activeWidget };
  const handlers = new Map();
  contribution.registerCommands({ registerCommand: (command, handler) => {
    assert.equal(command.label, undefined);
    assert.equal(handlers.has(command.id), false);
    handlers.set(command.id, handler.execute);
  } });
  return { contribution, handlers, widgets };
}
const callsNamed = (root, name) => {
  const calls = [];
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === name) calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return calls;
};

test('all five internal commands delegate to their corresponding widget methods', async () => {
  const { handlers, widgets } = fixture();
  assert.equal(handlers.size, 5);
  for (const [constant, id, method, args] of commands) {
    assert.equal(exports[constant].id, id);
    const registration = callsNamed(source, 'commands.registerCommand')
      .find(call => call.arguments[0].getText(source) === constant);
    assert.ok(registration);
    assert.equal(callsNamed(registration.arguments[1], method === 'focusTimelineItem'
      ? `widget.${method}` : `this.resolveWidget()?.${method}`).length, 1);
    const result = await handlers.get(id)(args);
    if (method === 'focusTimelineItem') assert.equal(result, true);
  }
  assert.deepEqual(widgets[0].calls, [
    ['focus', 'clip', { seek: true, reveal: true, pulse: true }], ['seek', 3],
    ['view', { startSeconds: 4, durationSeconds: 8, fit: true }], ['tool', 'razor'], ['snap', false],
  ]);
});

test('invalid arguments never call guarded widget methods', async () => {
  const { handlers, widgets } = fixture();
  for (const args of [undefined, null, {}, { itemId: 1 }, { itemId: '' }]) {
    assert.equal(await handlers.get('akari.timeline.focusItem')(args), false);
  }
  for (const args of [undefined, null, {}, { seconds: '3' }, { seconds: NaN }, { seconds: Infinity }]) {
    await handlers.get('akari.timeline.seek')(args);
  }
  for (const args of [undefined, null, {}, { tool: 'move' }, { tool: 1 }]) handlers.get('akari.timeline.setTool')(args);
  for (const args of [undefined, null, {}, { enabled: 1 }, { enabled: 'true' }]) handlers.get('akari.timeline.setSnap')(args);
  assert.deepEqual(widgets[0].calls, []);
});

test('view fields and focus flags are sanitized independently', async () => {
  const { handlers, widgets } = fixture();
  handlers.get('akari.timeline.setView')({ startSeconds: Infinity, durationSeconds: -1, fit: 'true' });
  handlers.get('akari.timeline.setView')({ startSeconds: 2, durationSeconds: NaN });
  await handlers.get('akari.timeline.focusItem')({ itemId: 'clip', seek: 1, reveal: 'true' });
  assert.deepEqual(widgets[0].calls, [['view', {}], ['view', { startSeconds: 2 }],
    ['focus', 'clip', { seek: false, reveal: false, pulse: false }]]);
});

test('without eligible widgets all commands safely do nothing', async () => {
  const detached = Object.assign(new AkariAnnotationsWidget(), { isAttached: false });
  const disposed = Object.assign(new AkariAnnotationsWidget(), { isDisposed: true });
  for (const candidates of [[], [detached, disposed, { isAttached: true, isDisposed: false }]]) {
    const { contribution, handlers } = fixture(candidates);
    assert.equal(contribution.resolveWidget(), undefined);
    for (const [, id, , args] of commands) {
      const result = await handlers.get(id)(args);
      assert.equal(result, id === 'akari.timeline.focusItem' ? false : undefined);
    }
  }
  assert.deepEqual(detached.calls, []);
  assert.deepEqual(disposed.calls, []);
});

test('active eligible widget wins, otherwise the first attached widget is used', () => {
  const first = new AkariAnnotationsWidget();
  const second = new AkariAnnotationsWidget();
  const detached = Object.assign(new AkariAnnotationsWidget(), { isAttached: false });
  const { contribution } = fixture([detached, first, second], second);
  assert.equal(contribution.resolveWidget(), second);
  contribution.shell.activeWidget = detached;
  assert.equal(contribution.resolveWidget(), first);
  contribution.shell.activeWidget = undefined;
  assert.equal(contribution.resolveWidget(), first);
});
