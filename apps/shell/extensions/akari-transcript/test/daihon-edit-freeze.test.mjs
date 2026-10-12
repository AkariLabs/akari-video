import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { CaptionWriteQueue, captionTemporaryPath } = require('../../akari-annotations/lib/node/caption-write-queue.js');
const { DaihonCaptionEditQueue, DaihonCaptionInput, DaihonReloadQueue, decideDaihonCaptionEdit, shouldReloadDaihonChanges } =
    require('../lib/common/daihon-caption-edit-queue.js');
const tick = () => new Promise(resolve => setImmediate(resolve));

function fakeClock() {
    let time = 0;
    let serial = 0;
    const timers = new Map();
    return {
        now: () => time,
        set(callback, delay) { const id = ++serial; timers.set(id, { at: time + delay, callback }); return id; },
        clear(id) { timers.delete(id); },
        advance(ms) {
            const end = time + ms;
            for (;;) {
                const next = [...timers].sort((left, right) => left[1].at - right[1].at)[0];
                if (!next || next[1].at > end) break;
                time = next[1].at;
                timers.delete(next[0]);
                next[1].callback();
            }
            time = end;
        }
    };
}

test('重なる字幕の読み書きはファイルごとに順序を守り、最後の内容が残る', async () => {
    const queue = new CaptionWriteQueue();
    let release;
    let text = '元';
    const steps = [];
    const first = queue.run('captions.json', async () => {
        steps.push('first-start');
        await new Promise(resolve => { release = resolve; });
        text = '一';
        steps.push('first-end');
    });
    const second = queue.run('captions.json', async () => {
        steps.push('second-start');
        text = '二';
    });
    await tick();
    assert.deepEqual(steps, ['first-start']);
    release();
    await Promise.all([first, second]);
    assert.deepEqual(steps, ['first-start', 'first-end', 'second-start']);
    assert.equal(text, '二');
});

test('字幕 RPC の読みと書きを重ねても最後の本文が実ファイルに残る', async () => {
    const { AkariAnnotationsServiceImpl } = require('../../akari-annotations/lib/node/akari-annotations-service.js');
    const root = await mkdtemp(join(tmpdir(), 'akari-caption-queue-'));
    const captionsPath = join(root, 'captions.json');
    try {
        await writeFile(captionsPath, `${JSON.stringify([{ id: 'c', start: 0, end: 1, text: '元', edited: false }])}\n`);
        const service = new AkariAnnotationsServiceImpl();
        let release;
        let entered;
        const writing = new Promise(resolve => { entered = resolve; });
        let calls = 0;
        service.writeCaptionAtomic = async (path, content) => {
            if (++calls === 1) {
                await new Promise(resolve => { release = resolve; entered(); });
            }
            await writeFile(path, content);
        };
        const target = { captionsUri: pathToFileURL(captionsPath).toString(),
            projectRootUri: pathToFileURL(root).toString(), captionId: 'c', draft: true };
        const first = service.setCaptionFields({ ...target, text: '一' });
        await writing;
        const second = service.setCaptionFields({ ...target, text: '二' });
        release();
        await Promise.all([first, second]);
        assert.equal(JSON.parse(await readFile(captionsPath, 'utf8'))[0].text, '二');
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('待ち行列に溜まった同一字幕の draft は最新だけを書き、全呼び出しが結果を受ける', async () => {
    const queue = new CaptionWriteQueue();
    let release;
    const busy = queue.run('captions.json', () => new Promise(resolve => { release = resolve; }));
    const writes = [];
    const first = queue.run('captions.json', async () => { writes.push('古い'); return '古い'; }, 'c');
    const latest = queue.run('captions.json', async () => { writes.push('新しい'); return '新しい'; }, 'c');
    release();
    await busy;
    assert.deepEqual(await Promise.all([first, latest]), ['新しい', '新しい']);
    assert.deepEqual(writes, ['新しい']);
});

test('確定を挟む draft は確定より前へ移さない', async () => {
    const queue = new CaptionWriteQueue();
    let release;
    const busy = queue.run('captions.json', () => new Promise(resolve => { release = resolve; }));
    const order = [];
    const before = queue.run('captions.json', async () => { order.push('前の draft'); }, 'c');
    const commit = queue.run('captions.json', async () => { order.push('確定'); });
    const after = queue.run('captions.json', async () => { order.push('次の draft'); }, 'c');
    release();
    await Promise.all([busy, before, commit, after]);
    assert.deepEqual(order, ['前の draft', '確定', '次の draft']);
});

test('失敗した書き込みのあとも確定でき、未保存分を次の書き込みより先に取り戻す', async () => {
    const steps = [];
    let fail = true;
    const queue = new DaihonCaptionEditQueue(100);
    const writeFirst = async () => {
        steps.push('一');
        if (fail) { fail = false; throw new Error('書けない'); }
    };
    await assert.rejects(queue.write('a', '一', writeFirst, true), /書けない/u);
    assert.equal(queue.get('a').text, '一');
    assert.equal(queue.get('a').unsaved, true);
    await queue.write('b', '二', async () => { steps.push('二'); }, true);
    assert.deepEqual(steps, ['一', '一', '二']);
    assert.equal(queue.get('a').unsaved, false);
});

test('保存待ちの再読込は古い本文を表示せず、ディスクが追いついたら上書きを外す', async () => {
    let release;
    const queue = new DaihonCaptionEditQueue(100);
    const writing = queue.write('a', '新しい', () => new Promise(resolve => { release = resolve; }), true);
    assert.equal(queue.reconcile('a', '古い').text, '新しい');
    await tick();
    release();
    await writing;
    assert.equal(queue.reconcile('a', '古い').text, '新しい');
    assert.equal(queue.reconcile('a', '新しい'), undefined);
});

test('確定待ちはディスク一致でも上書きを残し、成功後の再読込は不一致でも外す', async () => {
    const queue = new DaihonCaptionEditQueue(100);
    let release;
    const saving = queue.write('a', '入力', () => new Promise(resolve => { release = resolve; }), true);
    const revision = queue.revisionFor('a');
    assert.equal(queue.reconcile('a', '入力').text, '入力');
    await tick();
    release();
    await saving;
    assert.equal(queue.reconcile('a', '整形後').text, '入力');
    assert.equal(queue.clearSavedOverride('a', revision), true);
    assert.equal(queue.get('a'), undefined);
});

test('未保存の上書きは再読込が済んでも外さない', async () => {
    const queue = new DaihonCaptionEditQueue(100);
    await assert.rejects(queue.write('a', '入力', async () => { throw new Error('失敗'); }, true));
    const revision = queue.revisionFor('a');
    assert.equal(queue.clearSavedOverride('a', revision), false);
    assert.equal(queue.reconcile('a', 'ディスクの文字').text, '入力');
    assert.equal(queue.get('a').unsaved, true);
});

test('前の確定から次の before・途中保存・確定まで行編集の順序を守る', async () => {
    const queue = new DaihonCaptionEditQueue(100);
    const order = [];
    let release;
    const first = queue.write('a', '一', async () => {
        order.push('前の確定');
        await new Promise(resolve => { release = resolve; });
    }, true);
    const reload = queue.after(async () => { await first; order.push('前の再読込'); });
    const before = queue.read(async () => { order.push('次の before'); return '一'; });
    const draft = queue.write('b', '途中', async () => { order.push('次の途中保存'); });
    const final = queue.write('b', '二', async () => { order.push('次の確定'); }, true);
    await tick();
    assert.deepEqual(order, ['前の確定']);
    release();
    assert.equal(await before, '一');
    await Promise.all([first, reload, draft, final]);
    assert.deepEqual(order, ['前の確定', '前の再読込', '次の before', '次の途中保存', '次の確定']);
});

test('返らない保存でも確定と取消の待ち行列が進み、行は未保存のまま残る', async () => {
    const queue = new DaihonCaptionEditQueue(10);
    const never = () => new Promise(() => {});
    await assert.rejects(queue.write('a', '確定', never, true), /15 秒以内/u);
    assert.equal(queue.get('a').unsaved, true);
    const cancel = queue.write('b', '取消', async () => undefined, true);
    await assert.rejects(cancel, /15 秒以内/u);
    assert.equal(queue.get('b').unsaved, true);
});

test('時間切れの処理が後で返っても履歴相当の副作用は取り戻し側の一度だけ', async () => {
    const queue = new DaihonCaptionEditQueue(10);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let historyPushes = 0;
    const commit = async attempt => {
        await gate;
        if (attempt.abandoned) return;
        historyPushes++;
    };
    const timedOut = queue.write('a', '本文', commit, true);
    await assert.rejects(timedOut, /15 秒以内/u);
    release();
    await tick();
    assert.equal(historyPushes, 0);
    await queue.write('b', '次', async () => undefined, true);
    assert.equal(historyPushes, 1);
});

test('打ち切った書き込みの取り戻しでは保存後の履歴を一度だけ記録する', async () => {
    const queue = new DaihonCaptionEditQueue(10);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let histories = 0;
    const saving = queue.write('a', '本文', async attempt => {
        await gate;
        if (attempt.abandoned) return;
    }, true, async () => { histories++; });
    await assert.rejects(saving, /15 秒以内/u);
    release();
    await tick();
    assert.equal(histories, 0);
    await queue.write('b', '次', async () => undefined, true);
    assert.equal(histories, 1);
});

test('取消の準備読取りが一度失敗しても、取り戻しで読み直して書き戻す', async () => {
    const queue = new DaihonCaptionEditQueue(100);
    let source = '途中保存';
    let reads = 0;
    let restoreSource;
    const beforeWrite = async () => {
        restoreSource = undefined;
        if (++reads === 1) throw new Error('読取り失敗');
        if (source !== '元') restoreSource = '元';
    };
    await assert.rejects(queue.write('a', '元', async () => {
        if (restoreSource !== undefined) source = restoreSource;
    }, true, undefined, beforeWrite), /読取り失敗/u);
    assert.equal(source, '途中保存');
    assert.equal(queue.get('a').unsaved, true);
    await queue.write('b', '次', async () => undefined, true);
    assert.equal(reads, 2);
    assert.equal(source, '元');
    assert.equal(queue.get('a').unsaved, false);
});

test('未保存の失敗通知は一度だけ出し、回復で解除し、次の失敗で再び出す', async () => {
    const notices = [];
    const queue = new DaihonCaptionEditQueue(100, () => undefined, event => notices.push(event));
    let failing = true;
    const write = async () => { if (failing) throw new Error('保存失敗'); };
    await assert.rejects(queue.write('a', '一', write, true));
    await assert.rejects(queue.write('b', '二', write, true));
    assert.deepEqual(notices, ['show']);
    failing = false;
    await queue.write('c', '三', write, true);
    assert.deepEqual(notices, ['show', 'clear']);
    failing = true;
    await assert.rejects(queue.write('d', '四', write, true));
    assert.deepEqual(notices, ['show', 'clear', 'show']);
});

test('時間切れとその後の再試行失敗も未保存通知を一つにまとめる', async () => {
    const notices = [];
    const queue = new DaihonCaptionEditQueue(10, () => undefined, event => notices.push(event));
    const never = () => new Promise(() => {});
    await assert.rejects(queue.write('a', '本文', never, true), /15 秒以内/u);
    await assert.rejects(queue.write('b', '次', async () => undefined, true), /15 秒以内/u);
    assert.deepEqual(notices, ['show']);
});

test('15 秒を超える再読込は保存の打ち切りと未保存通知を起こさない', async () => {
    const notices = [];
    const queue = new DaihonCaptionEditQueue(10, () => undefined, event => notices.push(event));
    let release;
    const reload = new DaihonReloadQueue(() => new Promise(resolve => { release = resolve; }), () => true);
    await queue.write('a', '確定', async () => undefined, true);
    const pending = reload.request();
    await tick();
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.deepEqual(notices, []);
    assert.equal(queue.get('a').unsaved, false);
    release();
    await pending;
});

test('保存後の履歴用の読み取りが遅くても書き込み失敗にしない', async () => {
    const notices = [];
    const queue = new DaihonCaptionEditQueue(10, () => undefined, event => notices.push(event));
    let release;
    const saving = queue.write('a', '確定', async () => undefined, true,
        () => new Promise(resolve => { release = resolve; }));
    await tick();
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.deepEqual(notices, []);
    release();
    await saving;
    assert.equal(queue.get('a').unsaved, false);
});

test('保存前の読み取りが遅くても書き込み失敗にしない', async () => {
    const notices = [];
    const queue = new DaihonCaptionEditQueue(10, () => undefined, event => notices.push(event));
    let release;
    let writes = 0;
    const saving = queue.write('a', '確定', async () => { writes++; }, true, undefined,
        () => new Promise(resolve => { release = resolve; }));
    await tick();
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.deepEqual(notices, []);
    assert.equal(writes, 0);
    release();
    await saving;
    assert.equal(writes, 1);
});

test('ファイル監視と連続確定の再読込を一回にまとめ、実行中の追加要求は次の一回にする', async () => {
    let runs = 0;
    let release;
    let allowed = false;
    const reload = new DaihonReloadQueue(async () => {
        runs++;
        await new Promise(resolve => { release = resolve; });
    }, () => allowed);
    const first = [reload.request(), reload.request(), reload.request()];
    await tick();
    assert.equal(runs, 0);
    allowed = true;
    reload.resume();
    await tick();
    assert.equal(runs, 1);
    const second = [reload.request(), reload.request()];
    release();
    await Promise.all(first);
    await tick();
    assert.equal(runs, 2);
    release();
    await Promise.all(second);
    assert.equal(runs, 2);
});

test('同じ pid と時刻でも一時ファイル名は重複せず、.akari の有無で置き場を変える', () => {
    const paths = Array.from({ length: 300 }, () => captionTemporaryPath('/project/captions.json', true, 12, () => 0.5));
    assert.equal(new Set(paths).size, 300);
    assert.ok(paths.every(path => path.startsWith('/project/.akari/cache/write-tmp/')));
    assert.match(captionTemporaryPath('/project/captions.json', false, 12, () => 0.5),
        /^\/project\/captions\.json\.12\.[0-9]+\.[a-z0-9]+\.tmp$/u);
});

test('字幕の atomic 保存は .akari の中で一時ファイルを使い、rename 後は残さない', async () => {
    const { AkariAnnotationsServiceImpl } = require('../../akari-annotations/lib/node/akari-annotations-service.js');
    const root = await mkdtemp(join(tmpdir(), 'akari-caption-temp-'));
    try {
        await mkdir(join(root, '.akari'));
        const service = new AkariAnnotationsServiceImpl();
        await service.writeCaptionAtomic(join(root, 'captions.json'), '本文');
        assert.equal(await readFile(join(root, 'captions.json'), 'utf8'), '本文');
        assert.deepEqual(await readdir(root), ['.akari', 'captions.json']);
        assert.deepEqual(await readdir(join(root, '.akari', 'cache', 'write-tmp')), []);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('編集中の字幕と一時ファイルだけならリロードせず、他ファイル混在なら行う', () => {
    const captions = '/project/captions.json';
    const temporary = '/project/.akari/cache/write-tmp/captions.json.12.3.tmp';
    assert.equal(shouldReloadDaihonChanges([captions, temporary], captions, true), false);
    assert.equal(shouldReloadDaihonChanges([temporary], captions, false), false);
    assert.equal(shouldReloadDaihonChanges([captions, temporary, '/project/edit.json'], captions, true), true);
});

test('150ms 未満の間隔で打ち続けても最初の未保存入力から約 300ms ごとに draft が出る', () => {
    const clock = fakeClock();
    const drafts = [];
    const input = new DaihonCaptionInput('元', value => drafts.push({ at: clock.now(), value }),
        clock.now, clock.set, clock.clear);
    for (let index = 0; index < 20; index++) {
        input.input('字'.repeat(index + 1));
        clock.advance(70);
    }
    assert.ok(drafts.length >= 4);
    assert.equal(drafts[0].at, 300);
    assert.ok(drafts.every((draft, index) => index === 0 || draft.at - drafts[index - 1].at <= 370));
    assert.ok(drafts.every(draft => draft.value.length > 0));
});

test('IME 変換中と空欄と閉じた後は draft に出さない', () => {
    const clock = fakeClock();
    const drafts = [];
    const input = new DaihonCaptionInput('元', value => drafts.push(value), clock.now, clock.set, clock.clear);
    input.input('変換前');
    clock.advance(100);
    input.compositionStart();
    input.input('変換中', true);
    clock.advance(500);
    assert.deepEqual(drafts, []);
    input.compositionEnd('確定');
    clock.advance(150);
    assert.deepEqual(drafts, ['確定']);
    input.input('');
    clock.advance(500);
    assert.deepEqual(drafts, ['確定']);
    input.input('閉じる前');
    input.close();
    clock.advance(500);
    assert.deepEqual(drafts, ['確定']);
});

test('ブラウザのタイマーと同じ this 制約でも既定引数で途中保存とタイマー解除が動く', () => {
    const clock = fakeClock();
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    globalThis.setTimeout = function (callback, delay) {
        if (this !== globalThis && this !== undefined) throw new TypeError('Illegal invocation');
        return clock.set(callback, delay);
    };
    globalThis.clearTimeout = function (timer) {
        if (this !== globalThis && this !== undefined) throw new TypeError('Illegal invocation');
        clock.clear(timer);
    };
    try {
        const drafts = [];
        const input = new DaihonCaptionInput('元', value => drafts.push(value));
        input.input('一');
        clock.advance(150);
        assert.deepEqual(drafts, ['一']);
        input.input('二');
        input.compositionStart();
        clock.advance(300);
        assert.deepEqual(drafts, ['一']);
        input.compositionEnd('三');
        input.close();
        clock.advance(300);
        assert.deepEqual(drafts, ['一']);
        const next = new DaihonCaptionInput('元', value => drafts.push(value));
        next.input('四');
        next.close();
        clock.advance(300);
        assert.deepEqual(drafts, ['一']);
    } finally {
        globalThis.setTimeout = originalSetTimeout;
        globalThis.clearTimeout = originalClearTimeout;
    }
});

test('確定・取消・空欄の表示判断は保存を待たず決まる', () => {
    assert.deepEqual(decideDaihonCaptionEdit('元', '新', false),
        { text: '新', committed: true, emptyRejected: false });
    assert.deepEqual(decideDaihonCaptionEdit('元', '新', true),
        { text: '元', committed: false, emptyRejected: false });
    assert.deepEqual(decideDaihonCaptionEdit('元', ' ', false),
        { text: '元', committed: false, emptyRejected: true });
});
