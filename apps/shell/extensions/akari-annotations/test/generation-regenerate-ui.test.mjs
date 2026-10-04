import { readInspectorSource } from './helpers/inspector-source.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { InspectorElement, withInspectorDom } from './helpers/inspector-dom.mjs';
import { appendAiVideoCandidatesPanel, videoModelGroups } from '../lib/browser/inspector/ai-video-candidates-panel.js';

const source = readInspectorSource();
const ast = ts.createSourceFile('widget.ts', source, ts.ScriptTarget.Latest, true);
const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariInspectorWidget');
const method = widget.members.find(node => node.name?.getText(ast) === 'appendVideoCandidatesPanel').getText(ast);
const code = ts.transpileModule(`class Widget { ${method} }`, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
const Widget = new Function('appendAiVideoCandidatesPanel', 'videoModelGroups', `${code}; return Widget;`)(
  appendAiVideoCandidatesPanel, videoModelGroups);
const descendants = node => [node, ...node.children.flatMap(descendants)];

test('作り直しは N 案ボタンに変わり、今の候補だけに使用中の札を付ける', () => withInspectorDom(({ document }) => {
  const query = function (selector) {
    const name = selector.match(/^\[([^=\]]+)/u)?.[1];
    return name ? descendants(this).slice(1).filter(node => node.attributes.has(name)) : [];
  };
  InspectorElement.prototype.querySelectorAll = query;
  InspectorElement.prototype.querySelector = function (selector) { return query.call(this, selector)[0]; };
  InspectorElement.prototype.getAttribute = function (name) { return this.attributes.get(name) ?? null; };
  try {
    const oldPath = 'assets/generated/candidates/clip-a/old.mp4';
    const newPath = 'assets/generated/candidates/clip-a/new.mp4';
    const state = { selected: new Set(['fal:h3-i2v']), preferred: { defaultModelId: 'fal:h3-i2v', favorites: [] },
      estimate: { models: [{ modelId: 'fal:h3-i2v', estimateUsd: 0.36 }], totalUsd: 0.36 },
      thumbnails: new Map([[oldPath, 'data:old'], [newPath, 'data:new']]), running: false, loaded: true,
      batch: { routes: ['fal:h3-i2v'], completed: 1, running: false, results: [], candidates: [
        { route: 'fal:h3-i2v', status: 'done', ok: true, relativePath: newPath, durationSeconds: 6 },
        { route: 'fal:h3-i2v', status: 'done', ok: true, relativePath: oldPath, durationSeconds: 6 }
      ] } };
    const instance = new Widget();
    instance.body = document.body;
    instance.workspaceService = { tryGetRoots: () => [{ resource: { toString: () => 'file:///project' } }] };
    instance.aiVideoStates = new Map([['clip-a', state]]);
    instance.generationDone = new Map([['clip-a', { sourcePath: oldPath, meta: { kind: 'video', status: 'done' } }]]);
    instance.generationCatalog = [{ id: 'fal:h3-i2v', kind: 'video', family: 'H3', inputs: { first_frame: 'optional' } }];
    instance.appendVideoCandidatesPanel({ key: 'clip-a', itemId: 'clip-a', sourcePath: oldPath, duration: 6 });
    const create = document.body.querySelector('[data-akari-inspector-video-create]');
    assert.match(create.textContent, /^1 案を作り直す/u);
    const badges = document.body.querySelectorAll('[data-akari-inspector-video-in-use]');
    assert.equal(badges.length, 1);
    assert.equal(badges[0].attributes.get('data-akari-inspector-video-in-use'), oldPath);
    assert.equal(badges[0].textContent, '使用中');
  } finally {
    delete InspectorElement.prototype.querySelector;
    delete InspectorElement.prototype.querySelectorAll;
    delete InspectorElement.prototype.getAttribute;
  }
}));
