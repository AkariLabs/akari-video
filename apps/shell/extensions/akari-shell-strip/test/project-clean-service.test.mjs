import { strict as assert } from 'node:assert';
import test from 'node:test';

import { AkariProjectCleanServiceImpl, parseInspection } from '../lib/node/akari-project-clean-service.js';

// 分類の正典は akari clean（clean-manifest.mjs）側。ここで検査するのは
// 「CLI の出力を取り違えないこと」と「読めなかったのに 0 件と嘘をつかないこと」。

const SAMPLE = JSON.stringify({
    disposable: [
        { path: '.akari/render-tmp/run-1', class: 'disposable', reason: '書き出しの一時作業領域', files: 49, bytes: 31424345 },
        { path: '.akari/cache/thumbnails', class: 'disposable', reason: '再生成できるキャッシュ', files: 2, bytes: 1168 }
    ],
    keep: [{ path: 'edit.json', class: 'keep', reason: '編集内容の正本', files: 1, bytes: 10 }],
    undecided: [
        { path: '.akari/render-tmp/run-2', class: 'undecided', reason: '実行中の可能性', files: 3, bytes: 2048, held_reason: '実行中の可能性' },
        { path: 'source.mp4', class: 'undecided', reason: '宣言表に分類がありません', files: 1, bytes: 500 }
    ],
    totals: {}
});

test('parseInspection: disposable / undecided と合計バイト数を読む', () => {
    const inspection = parseInspection(`${SAMPLE}\n`);
    assert.equal(inspection.disposable.length, 2);
    assert.equal(inspection.disposableBytes, 31424345 + 1168);
    assert.equal(inspection.undecided.length, 2);
    assert.equal(inspection.undecidedBytes, 2048 + 500);
    assert.equal(inspection.disposable[0].path, '.akari/render-tmp/run-1');
});

test('parseInspection: held_reason を heldReason として拾う（保留の理由を人に見せる）', () => {
    const inspection = parseInspection(SAMPLE);
    const held = inspection.undecided.filter(entry => entry.heldReason);
    assert.equal(held.length, 1);
    assert.equal(held[0].heldReason, '実行中の可能性');
});

test('parseInspection: 警告行が前に混ざっても最後の JSON 行を採る', () => {
    const inspection = parseInspection(`provenance warning: something\n${SAMPLE}\n`);
    assert.equal(inspection.disposable.length, 2);
});

test('parseInspection: 壊れた出力は undefined（0 件と嘘をつかない）', () => {
    assert.equal(parseInspection(''), undefined);
    assert.equal(parseInspection('not json'), undefined);
    assert.equal(parseInspection('{ broken'), undefined);
    assert.equal(parseInspection(JSON.stringify({ keep: [] })), undefined);
});

/** CLI を起動しないスタブ。渡された引数だけを記録する。 */
function stubbedService(results) {
    class StubService extends AkariProjectCleanServiceImpl {
        constructor() {
            super();
            this.calls = [];
        }
        async findCleanCli() { return '/cli/akari.mjs'; }
        async spawnNodeScript(scriptPath, args) {
            this.calls.push(args);
            return results.shift();
        }
        fsPath() { return '/project'; }
    }
    return new StubService();
}

test('inspect: --json --dry-run で呼び、消さない', async () => {
    const service = stubbedService([{ exitCode: 0, stdout: SAMPLE, stderr: '' }]);
    const result = await service.inspect('file:///project');
    assert.equal(result.ok, true);
    assert.equal(result.inspection.disposable.length, 2);
    assert.deepEqual(service.calls, [['clean', '/project', '--json', '--dry-run']]);
});

test('inspect: CLI 不在なら理由を返す', async () => {
    class NoCli extends AkariProjectCleanServiceImpl {
        async findCleanCli() { return undefined; }
        fsPath() { return '/project'; }
    }
    const result = await new NoCli().inspect('file:///project');
    assert.equal(result.ok, false);
    assert.match(result.reason, /CLI が見つかりません/u);
});

test('inspect: CLI が失敗したら stderr の末尾を理由にする', async () => {
    const service = stubbedService([{ exitCode: 2, stdout: '', stderr: 'edit.json が見つかりません: /project\n' }]);
    const result = await service.inspect('file:///project');
    assert.equal(result.ok, false);
    assert.match(result.reason, /edit\.json が見つかりません/u);
});

test('inspect: exit 0 でも出力が読めなければ ok にしない', async () => {
    const service = stubbedService([{ exitCode: 0, stdout: 'garbage', stderr: '' }]);
    const result = await service.inspect('file:///project');
    assert.equal(result.ok, false);
    assert.match(result.reason, /読み取れません/u);
});

test('clean: --json --yes で呼び、消した件数とバイト数を返す', async () => {
    const service = stubbedService([{ exitCode: 0, stdout: SAMPLE, stderr: '' }]);
    const result = await service.clean('file:///project');
    assert.deepEqual(service.calls, [['clean', '/project', '--json', '--yes']]);
    assert.equal(result.cleaned, true);
    assert.equal(result.count, 2);
    assert.equal(result.bytes, 31424345 + 1168);
});

test('clean: 一部でも消せなければ cleaned にしない（成功と言い切らない）', async () => {
    const service = stubbedService([{
        exitCode: 1,
        stdout: SAMPLE,
        stderr: '削除に失敗しました: .akari/cache (EBUSY)\n一部を削除できませんでした。\n'
    }]);
    const result = await service.clean('file:///project');
    assert.equal(result.cleaned, false);
    assert.match(result.reason, /削除に失敗しました/u);
});
