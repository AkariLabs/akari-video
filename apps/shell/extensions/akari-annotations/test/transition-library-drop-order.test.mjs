// AKARI_WIDGET_SOURCE reruns the drop-order contract against a baseline widget source.
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { findMember } from './helpers/widget-source.mjs';
import { t, setLanguage } from '@akari-video/i18n';

const { ast: currentSource, node: dropMethod } = findMember('handleLibraryTransitionDrop', { in: 'widget' });
const override = process.env.AKARI_WIDGET_SOURCE;
const source = override
  ? ts.createSourceFile('widget.ts', readFileSync(override, 'utf8'), ts.ScriptTarget.Latest, true)
  : currentSource;
let captureDeclaration;
let stripDropMethod = override ? undefined : dropMethod;
let dragOverMethod;
const visit = node => {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'onWindowLibraryDrop') captureDeclaration = node;
  if (override && ts.isMethodDeclaration(node) && node.name.getText(source) === 'handleLibraryTransitionDrop') stripDropMethod = node;
  if (ts.isMethodDeclaration(node) && node.name.getText(source) === 'handleLibraryTransitionDragOver') dragOverMethod = node;
  ts.forEachChild(node, visit);
};
visit(source);
assert.ok(captureDeclaration);
assert.ok(stripDropMethod);
assert.ok(dragOverMethod);
const compiled = ts.transpileModule(`function makeCapture() { const ${captureDeclaration.getText(source)}; return onWindowLibraryDrop; }
class Handler { ${stripDropMethod.getText(source)} ${dragOverMethod.getText(source)} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2021 },
}).outputText;
const { Handler, makeCapture } = new Function(`${compiled}\nreturn { Handler, makeCapture };`)();

test('capture drop, microtask, strip drop, hit, apply stay in that order', async () => {
  const handler = new Handler();
  const phases = [];
  const payload = { kind: 'transition', id: 'fade', name: 'Cross fade' };
  handler.libraryDragPayload = payload;
  handler.stripScroll = {};
  handler.clearLibraryTransitionDragState = () => {
    phases.push('clear');
    handler.libraryDragPayload = undefined;
  };
  handler.isLibraryTransitionDragTransfer = () => true;
  handler.readLibraryTransitionDropPayload = () => payload;
  handler.hitLibraryTransitionDropTarget = () => {
    phases.push('hit');
    return { earlierIndex: 1, laterIndex: 2 };
  };
  handler.trackIdOfItem = () => 'video';
  handler.cutItemId = () => 'cut';
  handler.isTrackLocked = () => false;
  handler.applyLibraryTransitionDrop = () => { phases.push('apply'); };
  handler.libraryTransitionDropReason = () => 'no target';
  const event = {
    clientX: 100, clientY: 100, dataTransfer: {},
    composedPath: () => [handler.stripScroll],
    preventDefault() {}, stopPropagation() {},
  };
  const capture = makeCapture.call(handler);
  phases.push('capture');
  capture(event);
  await Promise.resolve(); // Browsers may run microtasks between the two listeners.
  phases.push('microtask');
  assert.equal(handler.libraryDragPayload, payload,
    'cleanup scheduled from capture in a microtask clears the drag before strip drop');
  handler.handleLibraryTransitionDrop(event);
  assert.deepEqual(phases, ['capture', 'microtask', 'hit', 'clear', 'apply']);
});

test('dragover accepts the strip without a target and drop reports the reason in notice and footer', () => {
  const handler = new Handler();
  const notices = [];
  handler.footer = {};
  handler.isLibraryTransitionDragTransfer = () => true;
  handler.hitLibraryTransitionDropTarget = () => undefined;
  handler.setHoveredTransitionDropTarget = () => {};
  handler.libraryTransitionDropReason = () => 'no visible boundary';
  handler.readLibraryTransitionDropPayload = () => ({ kind: 'transition' });
  handler.clearLibraryTransitionDragState = () => {};
  handler.showNotice = message => notices.push(message);
  const event = { clientX: 100, clientY: 100, dataTransfer: { dropEffect: 'none' },
    preventDefault() {}, stopPropagation() {} };
  handler.handleLibraryTransitionDragOver(event);
  assert.equal(event.dataTransfer.dropEffect, 'copy');
  handler.handleLibraryTransitionDrop(event);
  assert.deepEqual(notices, ['no visible boundary']);
  assert.equal(handler.footer.textContent, 'no visible boundary');
});

test('drop payload uses the drag-start mirror only when the transfer body is empty', () => {
  const { ast, node } = findMember('readLibraryTransitionDropPayload', { in: 'widget' });
  const code = ts.transpileModule(`class PayloadHandler { ${node.getText(ast)} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2021 },
  }).outputText;
  const PayloadHandler = new Function('LIBRARY_DRAG_MIME', 'parseLibraryTransitionDragPayload',
    `${code}\nreturn PayloadHandler;`)('application/x-akari-library-item', raw => ({ raw }));
  const handler = new PayloadHandler();
  const mirror = { kind: 'transition', id: 'mirror' };
  handler.libraryDragPayload = mirror;
  assert.deepEqual(handler.readLibraryTransitionDropPayload({ getData: () => 'body' }), { raw: 'body' });
  assert.equal(handler.readLibraryTransitionDropPayload({ getData: () => '' }), mirror);
  assert.equal(handler.readLibraryTransitionDropPayload(null), mirror);
});

test('drop outside video row and with no applicable visible boundary returns a reason', () => {
  const { ast, node } = findMember('libraryTransitionDropReason', { in: 'widget' });
  assert.ok(node);
  const code = ts.transpileModule(`class ReasonHandler { ${node.getText(ast)} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2021 },
  }).outputText;
  const ReasonHandler = new Function('t', 'nearestTransitionBoundary', 'primaryBoundaryBlock',
    `${code}\nreturn ReasonHandler;`)(t, (x, candidates) => candidates[0], blocks => blocks[0]);
  const handler = new ReasonHandler();
  handler.stripScroll = { getBoundingClientRect: () => ({ left: 0, right: 500, top: 100, bottom: 300 }) };
  handler.stripContent = { getBoundingClientRect: () => ({ top: 100 }) };
  handler.laneLayout = { tracks: [{ kind: 'cuts', hidden: false, top: 10, height: 40 }] };
  handler.transitionDropHitCandidates = () => [{ earlierIndex: 0, laterIndex: 1, x: 120, applicable: false }];
  handler.transitionBoundaryCandidates = () => [{ earlierIndex: 0, blocks: ['gap'] }];
  handler.boundaryBlockMessage = block => `blocked: ${block}`;
  setLanguage('en');
  try {
    assert.equal(handler.libraryTransitionDropReason(550, 120), t('transition.library.notice.outsideVideoRow'));
    assert.equal(handler.libraryTransitionDropReason(100, 200), t('transition.library.notice.outsideVideoRow'));
    assert.equal(handler.libraryTransitionDropReason(100, 120), 'blocked: gap');
    handler.transitionDropHitCandidates = () => [];
    assert.equal(handler.libraryTransitionDropReason(100, 120), t('transition.library.notice.nearBoundary'));
  } finally { setLanguage(undefined); }
});
