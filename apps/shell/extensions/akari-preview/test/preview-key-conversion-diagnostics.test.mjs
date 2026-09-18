// 不具合メモ 第12項: `Cannot get key code from the keyboard event: [object KeyboardEvent]` が
// 繰り返し出て Console が埋まり、本当のエラーを探せなかった。発火条件（押されたキー・IME 状態・
// event.key/code/keyCode）はログに無く未確定で、灰色との因果関係も未確認。
//
// ここで確かめるのは 2 点だけ:
//   - キー変換失敗が例外を伝播させない（監視経路が本筋のキー操作を壊さない）
//   - 失敗時にイベントの形（key / code / keyCode / IME 合成）が診断へ残る
// 例外そのものを出しているのは @theia/core（app.asar 内）なので、ここから止めることはしない。

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { createPreviewPage, injectedScript } from './helpers/preview-diagnostics-page.mjs';

const require = createRequire(import.meta.url);
const core = require('../lib/common/preview-init-diagnostics.js');
const host = require('../lib/browser/preview-diagnostics.js');

test('guardedKeyHandler は例外を伝播させず、診断へ回す', () => {
    const failures = [];
    const handler = core.guardedKeyHandler(
        () => { throw new Error('Cannot get key code from the keyboard event'); },
        (event, reason) => failures.push({ event, reason })
    );
    assert.doesNotThrow(() => handler({ key: 'a' }));
    assert.equal(failures.length, 1);
    assert.equal(failures[0].event.key, 'a');
    assert.match(String(failures[0].reason.message), /Cannot get key code/u);
});

test('guardedKeyHandler は診断側が落ちても本筋を止めない', () => {
    const handler = core.guardedKeyHandler(
        () => { throw new Error('変換失敗'); },
        () => { throw new Error('診断側も失敗'); }
    );
    assert.doesNotThrow(() => handler({}));
});

test('guardedKeyHandler は正常なキーをそのまま通す', () => {
    const seen = [];
    const handler = core.guardedKeyHandler(event => seen.push(event.key), () => {
        throw new Error('失敗経路へ来てはいけない');
    });
    handler({ key: 'Escape' });
    assert.deepEqual(seen, ['Escape']);
});

test('describeKeyEventConversionFailure は getter が投げても落ちず、形を残す', () => {
    const hostile = {
        get key() { throw new Error('key を読めない'); },
        code: 'KeyA',
        keyCode: 229,
        isComposing: true,
        repeat: false
    };
    const described = core.describeKeyEventConversionFailure(hostile, new Error('createKeyCode 失敗'));
    assert.match(described.message, /key=\(なし\)/u);
    assert.match(described.message, /code=KeyA/u);
    assert.match(described.message, /keyCode=229/u);
    assert.match(described.message, /IME合成=はい/u);
    assert.match(described.message, /長押し=いいえ/u);
    assert.match(described.message, /createKeyCode 失敗/u);
    assert.equal(described.keyCode, 229);
    assert.equal(described.composing, true);
});

test('describeKeyEventConversionFailure は null でも落ちない', () => {
    const described = core.describeKeyEventConversionFailure(null);
    assert.match(described.message, /key=\(なし\)/u);
    assert.equal(described.keyCode, null);
    assert.equal(described.composing, null);
});

test('疑わしいキーイベントの形を広く拾う（断定ではなく候補）', () => {
    assert.equal(core.isSuspiciousKeyEventShape({ key: 'Unidentified', code: 'KeyA', keyCode: 65 }), true);
    assert.equal(core.isSuspiciousKeyEventShape({ key: 'Process', code: '', keyCode: 229 }), true);
    assert.equal(core.isSuspiciousKeyEventShape({ key: 'a', code: 'KeyA', keyCode: 65, isComposing: true }), true);
    assert.equal(core.isSuspiciousKeyEventShape({ key: 'a', code: 'KeyA', keyCode: 0 }), true);
    assert.equal(core.isSuspiciousKeyEventShape({ key: '', code: 'KeyA', keyCode: 65 }), true);
    assert.equal(core.isSuspiciousKeyEventShape({ key: 'a', code: 'KeyA', keyCode: 65 }), false);
    assert.equal(core.isSuspiciousKeyEventShape({ key: 'Escape', code: 'Escape', keyCode: 27 }), false);
});

test('ホスト側: キー変換失敗はログへ残り、上限で止まる', async () => {
    const writes = [];
    const log = new host.PreviewDiagnosticsLog({
        resolveLogUri: async () => 'file:///home/u/.akari/logs/akari-preview-diagnostics.log',
        readText: async () => undefined,
        writeText: async (uri, text) => { writes.push(text); },
        warn: () => {}
    });
    const center = new host.PreviewDiagnosticsCenter({
        now: () => 1,
        nowIso: () => '2026-09-18T00:00:00.000Z',
        setTimeout: () => 0,
        clearTimeout: () => {},
        warn: () => {}
    }, log);
    for (let index = 0; index < host.PREVIEW_DIAGNOSTICS_KEY_LOG_LIMIT + 10; index += 1) {
        center.recordKeyConversionFailure({ key: 'a', code: 'KeyA', keyCode: 229, isComposing: true });
    }
    await log.settled();
    const lines = writes[writes.length - 1].split('\n').filter(Boolean).map(line => JSON.parse(line));
    const keyLines = lines.filter(line => line.event === 'key-conversion');
    assert.equal(keyLines.length, host.PREVIEW_DIAGNOSTICS_KEY_LOG_LIMIT);
    assert.equal(keyLines[0].entry, 'desktop-host');
    assert.match(keyLines[0].message, /keyCode=229/u);
    assert.match(keyLines[0].message, /IME合成=はい/u);
});

test('ホスト側: 疑わしい形だけを観測して記録する', async () => {
    const writes = [];
    const log = new host.PreviewDiagnosticsLog({
        resolveLogUri: async () => 'file:///home/u/.akari/logs/akari-preview-diagnostics.log',
        readText: async () => undefined,
        writeText: async (uri, text) => { writes.push(text); },
        warn: () => {}
    });
    const center = new host.PreviewDiagnosticsCenter({
        now: () => 1, nowIso: () => '2026-09-18T00:00:00.000Z',
        setTimeout: () => 0, clearTimeout: () => {}, warn: () => {}
    }, log);
    assert.equal(center.observeKeyEvent({ key: 'a', code: 'KeyA', keyCode: 65 }), false);
    assert.equal(center.observeKeyEvent({ key: 'Unidentified', code: '', keyCode: 0 }), true);
    await log.settled();
    const lines = (writes[writes.length - 1] ?? '').split('\n').filter(Boolean).map(line => JSON.parse(line));
    assert.equal(lines.filter(line => line.event === 'key-conversion').length, 1);
});

const guardScript = injectedScript('previewDiagnosticsGuardScript');

test('webview 側: 疑わしいキーは例外を投げずに診断へ畳んで記録される', () => {
    const page = createPreviewPage({ initial: { frameEngineEnabled: true } });
    page.run(guardScript);
    page.attachHost();
    // IME 合成中の keydown（第12項のスタックが通っていた textarea と同じ形）を 30 回。
    for (let index = 0; index < 30; index += 1) {
        assert.doesNotThrow(() => page.context.dispatch('keydown', {
            key: 'Process', code: '', keyCode: 229, isComposing: true, repeat: false
        }));
    }
    const events = page.diag().trace.events.filter(event => event.kind === 'key-conversion');
    assert.equal(events.length, 1, '同じ形は 1 行に畳む');
    assert.equal(events[0].count, 30);
    assert.match(events[0].message, /keyCode=229/u);
    assert.match(events[0].message, /IME合成=はい/u);
    // ホストへの報告は 5 件までに絞る（Console と IPC を埋めない）。
    const posted = page.posted.filter(
        message => message.phase === 'event' && message.event.kind === 'key-conversion'
    );
    assert.equal(posted.length, 5);
});

test('webview 側: 正常なキーは診断に何も残さない', () => {
    const page = createPreviewPage({ initial: { frameEngineEnabled: true } });
    page.run(guardScript);
    page.context.dispatch('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, isComposing: false });
    assert.equal(page.diag().trace.events.filter(event => event.kind === 'key-conversion').length, 0);
});

test('webview 側: safeKeyHandler は本筋の例外も診断へ回して止めない', () => {
    const page = createPreviewPage({ initial: { frameEngineEnabled: true } });
    page.run(guardScript);
    const wrapped = page.diag().safeKeyHandler(() => {
        throw new Error('Cannot get key code from the keyboard event');
    });
    assert.doesNotThrow(() => wrapped({ key: 'a', code: 'KeyA', keyCode: 65 }));
    const events = page.diag().trace.events.filter(event => event.kind === 'key-conversion');
    assert.equal(events.length, 1);
    assert.match(events[0].message, /Cannot get key code/u);
});

test('全画面解除の Escape 監視が guardedKeyHandler で包まれている', () => {
    const source = require('node:fs')
        .readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
    const at = source.indexOf('const onKeyDown = guardedKeyHandler<KeyboardEvent>(');
    assert.ok(at > 0, '全画面解除の keydown が包まれていない');
    const block = source.slice(at, at + 900);
    assert.match(block, /recordKeyConversionFailure/u);
    assert.match(source, /installKeyEventDiagnostics/u);
});
