import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { findMember, readSourceFile } from './helpers/widget-source.mjs';
import { CoalescedContentReload } from '../lib/common/coalesced-content-reload.js';

const source = readSourceFile('widget');
const member = findMember('refreshReferenceMediaUris', { in: 'widget' }).node.getText(source.ast);
const code = ts.transpileModule(`class Timeline { ${member} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const Timeline = new Function(`${code}\nreturn Timeline;`)();

test('素材の集合が同じなら RPC 0、増えた素材だけ解決し、台帳変更では全件を解決する', async () => {
    const calls = [];
    const root = { toString: () => 'root' };
    const timeline = new Timeline();
    Object.assign(timeline, { location: { editUri: { parent: root } }, referenceMediaUris: {},
        referenceMediaRoot: '', referenceMediaGeneration: 0, referenceMediaLedgerRevision: 0,
        referenceMediaResolvedRevision: -1, referenceMediaPathsKey: '', referenceMediaPathSet: new Set(),
        annotationsService: { projectReferenceMediaUris: async request => {
            calls.push(request.declaredPaths);
            return Object.fromEntries(request.declaredPaths.map(path => [path, `resolved:${path}`]));
        } } });
    const edit = paths => JSON.stringify({ sources: paths.map(path => ({ path })) });
    await timeline.refreshReferenceMediaUris(edit(['assets/a.mp4']));
    await timeline.refreshReferenceMediaUris(edit(['assets/a.mp4']));
    assert.deepEqual(calls, [['assets/a.mp4']]);
    await timeline.refreshReferenceMediaUris(edit(['assets/a.mp4', 'assets/b.mp4']));
    assert.deepEqual(calls.at(-1), ['assets/b.mp4']);
    assert.deepEqual(timeline.referenceMediaUris, {
        'assets/a.mp4': 'resolved:assets/a.mp4', 'assets/b.mp4': 'resolved:assets/b.mp4'
    });
    timeline.referenceMediaLedgerRevision++;
    await timeline.refreshReferenceMediaUris(edit(['assets/a.mp4', 'assets/b.mp4']));
    assert.deepEqual(calls.at(-1), ['assets/a.mp4', 'assets/b.mp4']);
});

test('台本通知と watcher は同じ読み直しキューに入り、saved-by と edit は並行に読む', () => {
    const text = source.text;
    assert.match(text, /const refreshDaihonCut = \(\): void => this\.watchedEditReload\.request\(\)/);
    assert.match(text, /event\.contains\(this\.location\.editUri\)\) this\.watchedEditReload\.request\(\)/);
    assert.match(text, /const \[diskSource, versionContext\] = await Promise\.all\(\[/);
    assert.match(text, /this\.newerVersionAtLoad = newerSavedByVersion\(/);
    assert.match(text, /this\.referenceMediaLedgerRevision\+\+;[\s\S]*?this\.forceWatchedEditReload = true/);
    assert.match(text, /onWillWriteEvent\(uri => \{[\s\S]*?this\.newerVersionAtLoad/);
});

test('同じ本文の二つの通知は reloadEdit 一回、読み込み中の別本文は次に反映する', async () => {
    const field = findMember('watchedEditReload', { in: 'widget' }).node.getText(source.ast);
    const fieldCode = ts.transpileModule(`class Watched { ${field} }`,
        { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const Watched = new Function('CoalescedContentReload', `${fieldCode}\nreturn Watched;`)(CoalescedContentReload);
    const widget = new Watched();
    let disk = 'one';
    let reads = 0;
    let reloads = 0;
    let release;
    widget.location = { editUri: {} };
    widget.fileService = { readFile: async () => { reads++; return { value: { toString: () => disk } }; } };
    widget.reloadEdit = async sourceText => {
        reloads++;
        if (reloads === 1) await new Promise(resolve => { release = resolve; });
        widget.lastAppliedEditSource = sourceText;
    };
    widget.watchedEditReload.request();
    await new Promise(resolve => setImmediate(resolve));
    widget.watchedEditReload.request();
    release();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(reloads, 1);
    assert.equal(reads, 2);
    disk = 'two';
    let releaseSecond;
    widget.reloadEdit = async sourceText => {
        reloads++;
        if (reloads === 2) await new Promise(resolve => { releaseSecond = resolve; });
        widget.lastAppliedEditSource = sourceText;
    };
    widget.watchedEditReload.request();
    await new Promise(resolve => setImmediate(resolve));
    disk = 'three';
    widget.watchedEditReload.request();
    releaseSecond();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(reloads, 3);
    assert.equal(widget.lastAppliedEditSource, 'three');
    widget.watchedEditReload.dispose();
});
