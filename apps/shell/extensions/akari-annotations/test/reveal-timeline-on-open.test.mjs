import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = ts.createSourceFile('akari-annotations-contribution.ts',
    readFileSync(new URL('../src/browser/akari-annotations-contribution.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true);
const contribution = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariAnnotationsContribution');
const method = contribution.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === 'revealTimelineOnOpen');
assert.ok(method);
const compiled = ts.transpileModule(`class Harness { ${method.getText(source)} } exports.Harness = Harness;`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const exports = {};
runInNewContext(compiled, { exports });

function fixture(tracks, mediaPaths = []) {
    const harness = new exports.Harness();
    let attached = 0;
    harness.timelineHidden = false;
    harness.timelineWidgets = [];
    harness.locateAll = async () => [{ editUri: 'edit.json', root: { resolve: name => name } }];
    harness.readText = async () => JSON.stringify({ tracks });
    harness.fileService = { resolve: async path => {
        if (path === 'assets') return { isFile: false, children: mediaPaths.map(name => ({ resource: name })) };
        return { isFile: true, resource: { path: { base: path } } };
    } };
    harness.attachPassively = async () => { attached++; };
    return { harness, attached: () => attached };
}

test('新規で tracks と assets の media が空ならタイムラインを出さない', async () => {
    const empty = fixture([]);
    await empty.harness.revealTimelineOnOpen();
    assert.equal(empty.attached(), 0);

    const media = fixture([], ['clip.mp4']);
    await media.harness.revealTimelineOnOpen();
    assert.equal(media.attached(), 1);

    const edited = fixture([{ id: 'visual' }]);
    await edited.harness.revealTimelineOnOpen();
    assert.equal(edited.attached(), 1);

    const nonMedia = fixture([], ['README.md']);
    await nonMedia.harness.revealTimelineOnOpen();
    assert.equal(nonMedia.attached(), 0);
});
