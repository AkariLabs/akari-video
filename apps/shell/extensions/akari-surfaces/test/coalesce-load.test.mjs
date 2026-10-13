import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { coalesceLoads } = await import('../lib/browser/home/coalesce-load.js');

function deferredRun() {
    const calls = [];
    const run = () => new Promise(resolve => calls.push(resolve));
    return { calls, run };
}

test('走っている間の依頼は 1 回にまとめ、終わってから読み直す', async () => {
    const { calls, run } = deferredRun();
    const load = coalesceLoads(run);
    const first = load();
    const second = load();
    const third = load();
    assert.equal(calls.length, 1, '重ねて走らせない');
    assert.equal(second, third, '待っている依頼は同じ 1 回を待つ');
    let secondDone = false;
    void second.then(() => { secondDone = true; });
    calls[0]();
    await first;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 2, '終わったあとに 1 回だけ読み直す');
    assert.equal(secondDone, false, '依頼より後に始まった読み込みが終わるまで待つ');
    calls[1]();
    await second;
    assert.equal(calls.length, 2);
});

test('失敗しても次の依頼で読み直せる', async () => {
    let n = 0;
    const load = coalesceLoads(async () => { n++; if (n === 1) throw new Error('boom'); });
    await assert.rejects(load());
    await load();
    assert.equal(n, 2);
});

test('ホームの一覧の読み直しはまとめる関数を通す', () => {
    const widget = readFileSync(new URL('../src/browser/akari-home-widget.tsx', import.meta.url), 'utf8');
    assert.match(widget, /protected readonly coalescedCreatorRootLoad = coalesceLoads\(\(\) => this\.readCreatorRootProjects\(\)\)/);
    assert.match(widget, /protected loadCreatorRootProjects\(\): Promise<void> \{\n\s+return this\.coalescedCreatorRootLoad\(\);/);
});

test('プロジェクトの詳細はフォルダの子を 1 件ずつ stat しない（resolveMetadata を付けない）', () => {
    const widget = readFileSync(new URL('../src/browser/akari-home-widget.tsx', import.meta.url), 'utf8');
    const body = widget.match(/protected async readProjectDetails\(uri: URI\): Promise<ProjectDetails> \{([\s\S]*?)\n    \}\n/)?.[1];
    assert.ok(body, 'readProjectDetails の本体');
    assert.doesNotMatch(body, /resolveMetadata: true/);
});
