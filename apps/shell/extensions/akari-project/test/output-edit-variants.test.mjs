import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { isEditDataFileName } = require('../lib/common/edit-data-file.js');
const { isTimelineEditFileName } = require('../../akari-annotations/lib/common/timeline-files.js');
const { dataFileIcon, editVariantDataFileLabel, orderDataEntries } = require('../lib/common/output-data-order.js');
const cases = [
    ['edit.json', true], ['edit.v20.json', true], ['edit.timeline-2.json', true],
    ['edit.t3d-backup.json', true], ['edit.json.bak', false], ['edit..json', false],
    ['Edit.json', false], ['edit.V20.json', false], ['captions.json', false]
];

test('project edit names match timeline discovery', () => {
    for (const [name, expected] of cases) {
        assert.equal(isEditDataFileName(name), expected, name);
        assert.equal(isEditDataFileName(name), isTimelineEditFileName(name), name);
    }
});

test('all edit variants appear after canonical edit and before other data', () => {
    const names = ['review.json', 'edit.v20.json', 'captions.json', 'edit.json', 'edit.timeline-2.json', 'edit.t3d-backup.json'];
    const entries = names.map((name, mtime) => ({ kind: 'data', name, mtime }));
    const sorted = orderDataEntries(entries, ['edit.json', 'captions.json', 'review.json']);
    assert.deepEqual(sorted.map(entry => entry.name), [
        'edit.json', 'edit.t3d-backup.json', 'edit.timeline-2.json', 'edit.v20.json', 'captions.json', 'review.json'
    ]);
    assert.equal(editVariantDataFileLabel('edit.json'), undefined);
    assert.equal(editVariantDataFileLabel('captions.json'), undefined);
    assert.equal(editVariantDataFileLabel('review.json'), undefined);
    assert.equal(editVariantDataFileLabel('edit.v20.json'), '編集データ（v20）');
    assert.equal(editVariantDataFileLabel('edit.timeline-2.json'), '編集データ（timeline-2）');
    assert.equal(dataFileIcon('edit.v20.json'), dataFileIcon('edit.json'));
});
const source = ts.createSourceFile('widget.tsx', readFileSync(new URL('../src/browser/akari-role-buckets-widget.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariRoleBucketsWidget');
const paneSource = ts.createSourceFile('pane.tsx', readFileSync(new URL('../src/browser/akari-outputs-pane.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const pane = paneSource.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariOutputsPane');
const method = name => widget.members.find(node => node.name?.getText(source) === name);
const harness = (name, dependencies) => {
    const code = ts.transpileModule('class Harness { ' + method(name).getText(source) + ' }', { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
    return new Function(...Object.keys(dependencies), code + '\nreturn Harness;')(...Object.values(dependencies));
};
const paneMethod = name => pane.members.find(node => node.name?.getText(paneSource) === name);
const paneHarness = (name, dependencies) => {
    const code = ts.transpileModule('class Harness { ' + paneMethod(name).getText(paneSource) + ' }', { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
    return new Function(...Object.keys(dependencies), code + '\nreturn Harness;')(...Object.values(dependencies));
};

test('outputs collection includes root edit variants and keeps canonical edit first', async () => {
    const Harness = paneHarness('loadOutputs', { isEditDataFileName, orderDataEntries });
    const root = { toString: () => 'root', resolve: name => ({ toString: () => name }) };
    const names = ['edit.v20.json', 'captions.json', 'edit.json', 'edit.timeline-2.json', 'edit.V20.json', 'review.json'];
    const files = names.map((name, mtime) => ({ resource: { path: { base: name } }, mtime, size: 1 }));
    const instance = new Harness();
    instance.host = { workflow: { workspaceRoot: root }, update: () => {},
        projectDataFiles: [{ name: 'edit.json' }, { name: 'captions.json' }, { name: 'review.json' }], rootReportFiles: [] };
    instance.outputsGeneration = 0;
    instance.collectTopLevelFiles = async uri => uri === root ? files : [];
    instance.collectPlanFiles = async () => [];
    instance.collectRootFilesNamed = async () => [];
    instance.buildOutputEntry = async (_, file, kind) => ({ kind, name: file.resource.path.base, mtime: file.mtime });
    instance.hydrateOutputThumbnails = async () => {};
    await instance.loadOutputs();
    assert.deepEqual(instance.outputs.map(entry => entry.name), [
        'edit.json', 'edit.timeline-2.json', 'edit.v20.json', 'captions.json', 'review.json'
    ]);
});

test('opening an edit output opens its preview and requested timeline', async () => {
    const opened = [];
    const Harness = harness('openFile', {
        open: async (_, uri) => { opened.push(['preview', uri.path.base]); },
        isEditDataFileName
    });
    const instance = new Harness();
    instance.openers = {};
    instance.workflow = { workspaceRoot: { toString: () => 'root' } };
    instance.commandService = { executeCommand: async (id, options) => { opened.push([id, options.editUri]); } };
    const uri = { path: { base: 'edit.v20.json' }, parent: { toString: () => 'root' }, toString: () => 'file:///edit.v20.json' };
    await instance.openFile(uri);
    assert.deepEqual(opened, [['preview', 'edit.v20.json'], ['akari.annotations.open', 'file:///edit.v20.json']]);
});

test('fixed data labels come from PROJECT_DATA_FILES, while the helper labels only variants', async () => {
    const declaration = source.statements.filter(ts.isVariableStatement)
        .flatMap(statement => [...statement.declarationList.declarations])
        .find(node => node.name.getText(source) === 'PROJECT_DATA_FILES');
    assert.ok(declaration?.initializer);
    const projectDataFiles = new Function('return ' + declaration.initializer.getText(source))();
    const Harness = paneHarness('buildOutputEntry', { editVariantDataFileLabel });
    const instance = new Harness();
    instance.host = { workflow: { relativePath: uri => uri.path.base }, projectDataFiles };
    const entry = name => instance.buildOutputEntry({}, { resource: { path: { base: name } }, mtime: 1, size: 1 }, 'data');
    assert.equal((await entry('edit.json')).title, '編集データ');
    assert.equal((await entry('captions.json')).title, '字幕データ');
    assert.equal((await entry('review.json')).title, 'レビュー・指摘');
    assert.equal((await entry('edit.v20.json')).title, '編集データ（v20）');
});
