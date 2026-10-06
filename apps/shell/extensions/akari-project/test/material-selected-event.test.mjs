import assert from 'node:assert/strict';
import { memberText } from './helpers/role-buckets-source.mjs';
import test from 'node:test';
import ts from 'typescript';
import { materialCardLayout } from '../lib/common/material-card-layout.js';
import { AKARI_MATERIAL_SELECTED_EVENT } from '../lib/common/material-selected-event.js';

const method = memberText('renderMaterialCard', { in: 'materials' });
const code = ts.transpileModule(`class Harness { ${method} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2021, jsx: ts.JsxEmit.React }
}).outputText;
const events = [];
const React = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }) };
const dependencies = {
  React, materialCardLayout, AKARI_MATERIAL_SELECTED_EVENT,
  AKARI_RADIUS: { panel: 8, chip: 4 },
  AKARI_SURFACE: { raised: 'raised', card: 'card' },
  AKARI_PROJECT_SURFACE: { item: 'project-item', elevated: 'project-elevated' },
  AKARI_BORDER: { accent: 'accent-border', ghost: 'ghost-border' },
  MATERIAL_CARD_FLAG_STYLE: { background: 'flag' }, MATERIAL_CARD_SUBFLAG_STYLE: { background: 'subflag' },
  AKARI_FAINT: 'faint', MaterialCardHoverPreview: () => null,
  formatDurationBadge: () => '0:00', referencePresentation: () => ({ lab: false })
};
const Harness = new Function(...Object.keys(dependencies), `${code}; return Harness;`)(...Object.values(dependencies));
const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const previousCustomEvent = Object.getOwnPropertyDescriptor(globalThis, 'CustomEvent');
Object.defineProperty(globalThis, 'window', { configurable: true, value: { dispatchEvent: event => events.push(event) } });
Object.defineProperty(globalThis, 'CustomEvent', { configurable: true, value: class { constructor(type, options) { this.type = type; this.detail = options.detail; } } });
test.after(() => {
  if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else delete globalThis.window;
  if (previousCustomEvent) Object.defineProperty(globalThis, 'CustomEvent', previousCustomEvent); else delete globalThis.CustomEvent;
});

function fixture() {
  events.length = 0;
  const instance = new Harness();
  const opened = [];
  instance.host = {
    generationPick: {},
    generationPickCardProps: () => ({}),
    renderGenerationPickBadge: () => null,
    placeholderIcon: () => 'icon',
    workflow: { workspaceRoot: { toString: () => 'file:///project' } },
    update: () => {},
    openFile: uri => { opened.push(uri.toString()); },
    openMaterialContextMenu: () => {},
    assetCatalogItems: [],
    files: {}, materialPreviewService: {}, workspaceService: {}
  };
  instance.transcriptStateByPath = {};
  return { instance, opened };
}
function entry(overrides = {}) {
  return { uri: { toString: () => 'file:///project/assets/interview.wav', path: { base: 'interview.wav' } },
    relativePath: 'assets/interview.wav', name: 'interview.wav', kind: 'audio', analyzed: false,
    unorganized: false, ...overrides };
}

test('カードクリックは detail を通知し、中央で開き、選択枠を付ける', () => {
  const { instance, opened } = fixture();
  const row = entry();
  const card = instance.renderMaterialCard(row);
  assert.equal(card.props.style.border, 'ghost-border');
  assert.equal(card.props.style.background, 'project-item');
  const hovered = { currentTarget: { style: {} } };
  card.props.onMouseEnter(hovered);
  assert.equal(hovered.currentTarget.style.background, 'project-elevated');
  card.props.onMouseLeave(hovered);
  assert.equal(hovered.currentTarget.style.background, 'project-item');
  card.props.onClickCapture({ target: {} });
  card.props.onClick();
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'akari.material.selected');
  assert.deepEqual(events[0].detail, { projectRoot: 'file:///project', relativePath: row.relativePath,
    kind: 'audio', name: row.name });
  assert.deepEqual(opened, ['file:///project/assets/interview.wav']);
  assert.equal(instance.renderMaterialCard(row).props.style.border, 'accent-border');
  assert.equal(instance.renderMaterialCard(row).props.style.background, 'project-elevated');
  card.props.onMouseLeave(hovered);
  assert.equal(hovered.currentTarget.style.background, 'project-elevated');
  assert.equal(instance.renderMaterialCard(entry({ relativePath: 'assets/other.mp4' })).props.style.border, 'ghost-border');
});

test('missing カードは通知も中央で開く動作もない', () => {
  const { instance, opened } = fixture();
  const card = instance.renderMaterialCard(entry({ missing: true }));
  card.props.onClickCapture({ target: {} });
  card.props.onClick();
  assert.equal(events.length, 0);
  assert.deepEqual(opened, []);
  assert.equal(instance.selectedMaterialPath, undefined);
});

test('素材グループに主メディアがあれば、そのファイルのパスと種類を通知する', () => {
  const { instance, opened } = fixture();
  const row = entry({
    uri: { toString: () => 'file:///project/assets/interview', path: { base: 'interview' } },
    relativePath: 'assets/interview', mediaRelativePath: 'assets/interview/main.wav',
    assetGroup: { category: 'audio' }, name: '取材音声'
  });
  const card = instance.renderMaterialCard(row);
  card.props.onClickCapture({ target: {} });
  card.props.onClick();
  assert.deepEqual(events[0].detail, { projectRoot: 'file:///project',
    relativePath: 'assets/interview/main.wav', kind: 'audio', name: '取材音声' });
  assert.deepEqual(opened, ['file:///project/assets/interview']);
  assert.equal(instance.renderMaterialCard(row).props.style.border, 'accent-border');
});

test('素材グループに主メディアがなければディレクトリを other として通知する', () => {
  const { instance, opened } = fixture();
  const row = entry({
    uri: { toString: () => 'file:///project/assets/interview', path: { base: 'interview' } },
    relativePath: 'assets/interview', assetGroup: { category: 'audio' }, name: '取材音声'
  });
  const card = instance.renderMaterialCard(row);
  card.props.onClickCapture({ target: {} });
  card.props.onClick();
  assert.deepEqual(events[0].detail, { projectRoot: 'file:///project',
    relativePath: 'assets/interview', kind: 'other', name: '取材音声' });
  assert.deepEqual(opened, ['file:///project/assets/interview']);
  assert.equal(instance.renderMaterialCard(row).props.style.border, 'accent-border');
});
