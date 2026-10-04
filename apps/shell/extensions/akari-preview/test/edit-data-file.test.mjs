import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { readHandlerSource } from './helpers/handler-source.mjs';

const require = createRequire(import.meta.url);
const { isEditDataFileName } = require('../lib/common/edit-data-file.js');
const { isTimelineEditFileName } = require('../../akari-annotations/lib/common/timeline-files.js');
const cases = [
    ['edit.json', true], ['edit.v20.json', true], ['edit.timeline-2.json', true],
    ['edit.t3d-backup.json', true], ['edit.json.bak', false], ['edit..json', false],
    ['Edit.json', false], ['edit.V20.json', false], ['captions.json', false]
];

test('preview edit names match timeline discovery for canonical, variant, and invalid names', () => {
    for (const [name, expected] of cases) {
        assert.equal(isEditDataFileName(name), expected, name);
        assert.equal(isEditDataFileName(name), isTimelineEditFileName(name), name);
    }
});

test('output preview opener gives every edit variant priority 1200', () => {
    const source = ts.createSourceFile('open-handler.ts', readHandlerSource(), ts.ScriptTarget.Latest, true);
    const handler = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariOutputPreviewOpenHandler');
    assert.ok(handler);
    const method = handler.members.find(node => node.name?.getText(source) === 'canHandle');
    assert.ok(method);
    const code = ts.transpileModule('class Handler { ' + method.getText(source) + ' }', { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
    const Handler = new Function('isEditDataFileName', code + '\nreturn Handler;')(isEditDataFileName);
    for (const [name, expected] of cases) {
        assert.equal(new Handler().canHandle({ path: { base: name } }), expected ? 1200 : 0, name);
    }
});