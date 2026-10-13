import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { TRANSITION_FAMILIES } from '@akari-video/edit-store';
import { transitionPickerLayout, rememberedTransitionType } from '../lib/common/transition-picker-layout.js';
import { initialTransitionPickerFocusFamily } from '../lib/browser/transition-picker.js';
import { transitionPickerShieldRects } from '../lib/common/transition-picker-shield.js';
import { transitionDeclarationIsDead, transitionWriteIsBlocked } from '../lib/common/transition-boundary-state.js';

test('picker stays above the boundary and fits horizontally at both viewport edges', () => {
  for (const left of [0, 890]) {
    const layout = transitionPickerLayout({ left, right: left + 10, top: 400, bottom: 422 }, 900, 700, 270);
    assert.equal(layout.width, 520);
    assert.ok(layout.top + layout.height < 400);
    assert.ok(layout.left >= 8 && layout.left + layout.width <= 892);
    assert.ok(layout.arrowLeft >= 9 && layout.arrowLeft <= layout.width - 9);
  }
  const narrow = transitionPickerLayout({ left: 180, right: 200, top: 208, bottom: 230 }, 400, 600, 300);
  assert.equal(narrow.width, 384);
  assert.equal(narrow.height, 191);
  assert.equal(narrow.top, 8);
  const minimum = transitionPickerLayout({ left: 180, right: 200, top: 190, bottom: 212 }, 400, 600, 300);
  assert.equal(minimum.height, 180);
});

test('picker shields cover only visible iframe and webview rectangles', () => {
  const frames = [
    { left: 100, top: 50, right: 400, bottom: 250 },
    { left: -30, top: 100, right: 80, bottom: 220 },
    { left: 750, top: 550, right: 850, bottom: 650 },
    { left: 810, top: 0, right: 900, bottom: 100 },
    { left: 10, top: 10, right: 10, bottom: 40 },
  ];
  assert.deepEqual(transitionPickerShieldRects(frames, 800, 600), [
    { left: 100, top: 50, width: 300, height: 200 },
    { left: 0, top: 100, width: 80, height: 120 },
    { left: 750, top: 550, width: 50, height: 50 },
  ]);
  assert.deepEqual(frames[0], { left: 100, top: 50, right: 400, bottom: 250 });
});

test('remembered direction picks a family type and directionless families keep their own type', () => {
  const wipe = TRANSITION_FAMILIES.find(entry => entry.family === 'wipe');
  const fade = TRANSITION_FAMILIES.find(entry => entry.family === 'fade');
  assert.equal(rememberedTransitionType(wipe), 'wipe-left');
  assert.equal(rememberedTransitionType(wipe, 'down'), 'wipe-down');
  assert.equal(rememberedTransitionType(fade), 'fade');
  assert.equal(rememberedTransitionType(fade, 'down'), 'fade');
});

test('picker focuses its grid when no family is selected', () => {
  const families = TRANSITION_FAMILIES.map(entry => entry.family);
  assert.equal(initialTransitionPickerFocusFamily(undefined, families), undefined);
  assert.equal(initialTransitionPickerFocusFamily('fade', families), 'fade');
  assert.equal(initialTransitionPickerFocusFamily('missing', families), undefined);
});

test('Escape closes only the picker and stops the timeline selection handler', () => {
  const source = ts.createSourceFile('transition-picker.ts',
    readFileSync(new URL('../src/browser/transition-picker.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true);
  let declaration;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'keydown') declaration = node;
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(declaration);
  const code = ts.transpileModule(`const ${declaration.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2021 },
  }).outputText;
  let activeBoundary = true;
  let closed = 0;
  let stopped = false;
  const keydown = new Function('close', `${code}\nreturn keydown;`)(() => { closed++; });
  const event = { key: 'Escape', preventDefault() {},
    stopPropagation() { stopped = true; }, stopImmediatePropagation() { stopped = true; } };
  keydown(event);
  if (!stopped) activeBoundary = false;
  assert.equal(closed, 1);
  assert.equal(activeBoundary, true);
  assert.equal(stopped, true);
});

test('locked declarations keep their band and cannot be removed', () => {
  assert.equal(transitionDeclarationIsDead(true, ['locked'], false, false), false);
  assert.equal(transitionDeclarationIsDead(true, ['gap'], false, false), true);
  assert.equal(transitionDeclarationIsDead(true, [], false, true), true);
  assert.equal(transitionWriteIsBlocked(null, ['locked']), true);
  assert.equal(transitionWriteIsBlocked(null, ['gap']), false);
  assert.equal(transitionWriteIsBlocked({ type: 'fade' }, ['gap']), true);
});
