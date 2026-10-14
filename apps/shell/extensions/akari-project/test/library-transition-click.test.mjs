import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { TRANSITION_VOCABULARY } from '@akari-video/edit-store';
import { transitionDisplayCategory, transitionDisplayName } from '../lib/common/library-home-view.js';

const source = ts.createSourceFile('akari-library-pane.tsx', readFileSync(new URL('../src/browser/akari-library-pane.tsx', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const methods = new Map();
const visit = node => {
  if (ts.isMethodDeclaration(node) && ['renderTransitionLibrary', 'transitionRow', 'transitionName'].includes(node.name.getText(source))) {
    methods.set(node.name.getText(source), node);
  }
  ts.forEachChild(node, visit);
};
visit(source);
assert.ok(methods.has('renderTransitionLibrary'));
const compiled = ts.transpileModule(`class Handler { ${[...methods.values()].map(method => method.getText(source)).join('\n')} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2021, jsx: ts.JsxEmit.React },
}).outputText;
const React = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }) };
const Handler = new Function('React', 'TRANSITION_VOCABULARY', 'CATALOG_GRID_COLUMNS', 'CATALOG_GRID_GAP',
  'LIBRARY_HOVER_DESCRIPTION_ID', 'libraryHoverPreview', 'LibraryDotsCorner', 'TransitionStrip', 't',
  'AKARI_RADIUS', 'AKARI_SURFACE', 'AKARI_BORDER', 'TRANSITION_APPLY_TO_ACTIVE_BOUNDARY_COMMAND_ID',
  'transitionDisplayName', 'transitionDisplayCategory', 'getLanguage',
  `${compiled}\nreturn Handler;`)(React, TRANSITION_VOCABULARY, 'repeat(3,1fr)', '8px', 'hover',
  () => undefined, () => undefined, () => undefined, key => key,
  { panel: 6, chip: 3 }, { raised: '#222' }, { ghost: '1px solid #333' }, 'akari.transition.applyToActiveBoundary',
  transitionDisplayName, transitionDisplayCategory, () => 'ja');
const findCard = tree => {
  if (!tree || typeof tree !== 'object') return undefined;
  if (tree.props?.['data-akari-library-transition']) return tree;
  return tree.children?.map(findCard).find(Boolean);
};

test('transition card click applies its exact type; Enter still opens information', async () => {
  const calls = [];
  const handler = new Handler();
  handler.host = {
    catalogQuery: '', presetPassesLibraryFilter: () => true, transitionPreviewUrls: {}, libraryFavorites: new Set(),
    commandService: { executeCommand: (...args) => { calls.push(args); return Promise.resolve(); } },
    openLibraryInfo: (...args) => calls.push(['info', ...args]),
    handleLibraryTransitionDragEnd: () => calls.push(['dragEnd']),
  };
  const card = findCard(handler.renderTransitionLibrary());
  assert.ok(card);
  card.props.onClick();
  assert.deepEqual(calls[0], ['akari.transition.applyToActiveBoundary',
    { type: card.props['data-akari-library-transition'] }]);
  const target = {};
  card.props.onKeyDown({ key: 'Enter', target, currentTarget: target, preventDefault() {} });
  assert.equal(calls[1][0], 'info');
  assert.equal(calls.length, 2);
  card.props.onDragEnd();
  card.props.onClick();
  assert.equal(calls.filter(call => call[0] === 'akari.transition.applyToActiveBoundary').length, 1);
});
