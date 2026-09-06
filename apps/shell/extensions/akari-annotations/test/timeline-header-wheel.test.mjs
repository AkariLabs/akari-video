import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { planTimelineHeaderWheel } = require('../lib/common/timeline-header-wheel.js');
const wheel = overrides => ({ deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, shiftKey: false, ...overrides });

for (const [name, input, expected] of [
  ['idle', {}, { kind: 'none' }],
  ['idle with Shift', { shiftKey: true }, { kind: 'none' }],
  ['Ctrl precedes pan', { ctrlKey: true, shiftKey: true, deltaX: 100, deltaY: -2 }, { kind: 'zoom', deltaY: -2 }],
  ['Ctrl zero', { ctrlKey: true }, { kind: 'zoom', deltaY: 0 }],
  ['horizontal', { deltaX: -120 }, { kind: 'pan', delta: -120 }],
  ['equal axes choose horizontal', { deltaX: -4, deltaY: 4 }, { kind: 'pan', delta: -4 }],
  ['Shift vertical pans', { shiftKey: true, deltaX: 1, deltaY: -20 }, { kind: 'pan', delta: -20 }],
  ['Shift retains dominant horizontal like strip', { shiftKey: true, deltaX: 20, deltaY: 1 }, { kind: 'pan', delta: 20 }],
  ['vertical', { deltaX: 1, deltaY: 120 }, { kind: 'scroll', deltaY: 120 }],
  ['vertical negative', { deltaY: -120 }, { kind: 'scroll', deltaY: -120 }],
  ['line scroll', { deltaMode: 1, deltaY: 3 }, { kind: 'scroll', deltaY: 48 }],
  ['page scroll', { deltaMode: 2, deltaY: -1 }, { kind: 'scroll', deltaY: -400 }],
  ['line pan', { deltaMode: 1, deltaX: 2 }, { kind: 'pan', delta: 32 }],
  ['page Shift pan', { deltaMode: 2, deltaY: 1, shiftKey: true }, { kind: 'pan', delta: 400 }],
  ['line zoom', { deltaMode: 1, deltaY: -2, ctrlKey: true }, { kind: 'zoom', deltaY: -32 }],
  ['page zoom', { deltaMode: 2, deltaY: 1, ctrlKey: true }, { kind: 'zoom', deltaY: 400 }],
]) {
  test(`header wheel plan: ${name}`, () => assert.deepEqual(planTimelineHeaderWheel(wheel(input)), expected));
}

const sourceText = readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');
const source = ts.createSourceFile('widget.ts', sourceText, ts.ScriptTarget.Latest, true);
const widget = source.statements.find(node => ts.isClassDeclaration(node)
  && node.name?.text === 'AkariAnnotationsWidget');
const methods = ['onTrackHeaderWheel', 'onWheelZoom', 'wheelZoomDuration'].map(name => {
  const method = widget.members.find(member => member.name?.getText(source) === name);
  assert.ok(method, name);
  return method.getText(source);
});
const constants = source.statements.filter(ts.isVariableStatement).flatMap(statement =>
  statement.declarationList.declarations.filter(declaration => /^ZOOM_(WHEEL_SENSITIVITY|EVENT_FACTOR_(MIN|MAX))$/.test(declaration.name.getText(source)))
    .map(declaration => `const ${declaration.getText(source)};`));
assert.equal(constants.length, 3);
const code = ts.transpileModule(`${constants.join('\n')} class Handler { ${methods.join('\n')} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2021 },
}).outputText;
const Handler = new Function('planTimelineHeaderWheel', `${code}\nreturn Handler;`)(planTimelineHeaderWheel);

function fixture(width = 500) {
  const handler = new Handler();
  handler.strip = { getBoundingClientRect: () => ({ width, left: 100 }) };
  handler.stripScroll = { scrollTop: 30 };
  handler.viewStart = 20;
  handler.visibleDuration = () => 40;
  handler.pans = [];
  handler.zooms = [];
  handler.panViewBy = delta => handler.pans.push(delta);
  handler.applyViewDuration = (...args) => handler.zooms.push(args);
  const dispatch = (overrides, method = 'onTrackHeaderWheel') => {
    let prevented = 0;
    handler[method]({ ...wheel(overrides), clientX: 225, preventDefault: () => prevented++ });
    return prevented;
  };
  return { handler, dispatch };
}

test('header vertical wheel scrolls the strip; empty gesture is untouched', () => {
  const { handler, dispatch } = fixture();
  assert.equal(dispatch({ deltaY: 120 }), 1);
  assert.equal(handler.stripScroll.scrollTop, 150);
  assert.equal(dispatch({}), 0);
  assert.deepEqual(handler.pans, []);
  assert.deepEqual(handler.zooms, []);
});

test('header pan uses strip width and normalizes line units; zero width is harmless', () => {
  const { handler, dispatch } = fixture();
  assert.equal(dispatch({ deltaY: 2, deltaMode: 1, shiftKey: true }), 1);
  assert.deepEqual(handler.pans, [32 / 500 * 40]);
  assert.equal(handler.stripScroll.scrollTop, 30);
  const zero = fixture(0);
  assert.equal(zero.dispatch({ deltaX: 20 }), 1);
  assert.deepEqual(zero.handler.pans, []);
});

test('header zoom shares strip coefficients and clamps, with center instead of cursor anchor', () => {
  for (const deltaY of [-100000, -10, 10, 100000]) {
    const { handler, dispatch } = fixture();
    assert.equal(dispatch({ ctrlKey: true, deltaY }), 1);
    dispatch({ ctrlKey: true, deltaY }, 'onWheelZoom');
    assert.equal(handler.zooms[0][0], handler.zooms[1][0]);
    assert.deepEqual(handler.zooms[0].slice(1), [40, 0.5]);
    assert.deepEqual(handler.zooms[1].slice(1), [30, 0.25]);
    assert.ok(deltaY < 0 ? handler.zooms[0][0] < 40 : handler.zooms[0][0] > 40);
  }
});

test('header column listener includes ruler spacer and retains existing scroll synchronization', () => {
  assert.match(sourceText, /this\.trackHeaderColumn\.addEventListener\('wheel', event => this\.onTrackHeaderWheel\(event\), \{ passive: false \}\)/);
  assert.match(sourceText, /this\.trackHeaderColumn\.append\(this\.trackHeaderRulerSpacer, this\.trackHeadersViewport\)/);
  assert.match(sourceText, /this\.stripScroll\.addEventListener\('scroll', \(\) => \{\s*this\.trackHeaders\.style\.transform = `translateY\(\$\{-this\.stripScroll\.scrollTop\}px\)`;/);
});
