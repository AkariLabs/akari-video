import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { createPreviewPage, injectedScript } from './helpers/preview-diagnostics-page.mjs';

const require = createRequire(import.meta.url);
const tracker = require('../lib/electron-main/preview-renderer-tracker.js');
const host = require('../lib/browser/preview-diagnostics.js');
const core = require('../lib/common/preview-init-diagnostics.js');

test('URL と PID の対応はプレビューだけを保持し、正常な遷移と停止を分ける', () => {
    const table = new tracker.PreviewRendererTracker();
    assert.equal(tracker.previewWidgetIdFromUrl('https://a.webview.localhost/?id=akari-output-preview-abc'), 'akari-output-preview-abc');
    assert.equal(tracker.previewWidgetIdFromUrl('https://a.webview.localhost/?id=akari-preview-abc'), 'akari-preview-abc');
    for (const id of ['akari-material-preview', 'akari-image-abc', 'akari-audio-abc',
        'akari-fragment-preview-abc', 'akari-font-specimen-abc']) {
        assert.equal(core.previewDiagnosticsKindFromWidgetId(id), undefined);
        assert.equal(tracker.previewWidgetIdFromUrl(`https://a.webview.localhost/?id=${id}`), undefined);
    }
    assert.equal(core.previewDiagnosticsKindFromWidgetId('akari-output-preview-abc'), 'output');
    assert.equal(core.previewDiagnosticsKindFromWidgetId('akari-preview-abc'), 'raw');
    assert.equal(tracker.previewWidgetIdFromUrl('https://a.webview.localhost/?id=other'), undefined);
    assert.equal(tracker.previewWidgetIdFromUrl('https://example.com/?id=akari-preview-fake'), undefined);
    const valid = () => true;
    table.observe(1, 2, 200, 'https://a.webview.localhost/?id=akari-output-preview-abc');
    assert.deepEqual(table.poll(new Set([200]), valid), []);
    const unsafeAfterExit = () => { throw new Error('停止後の WebFrameMain getter を読んだ'); };
    assert.deepEqual(table.poll(new Set(), unsafeAfterExit), []);
    assert.deepEqual(table.poll(new Set(), unsafeAfterExit), [{ contentsId: 1, pid: 200, widgetId: 'akari-output-preview-abc' }]);
    assert.deepEqual(table.poll(new Set(), valid), []);
    table.observe(1, 2, 201, 'https://a.webview.localhost/?id=akari-output-preview-abc');
    table.poll(new Set([201]), valid);
    table.observe(1, 2, 202, 'https://a.webview.localhost/?id=akari-output-preview-abc');
    assert.deepEqual(table.poll(new Set(), valid), []);
    table.poll(new Set([202]), valid);
    assert.deepEqual(table.poll(new Set(), () => false), []);
});

test('追跡 frame が 0 件ならメトリクスを読まず、追跡中だけ読む', () => {
    const table = new tracker.PreviewRendererTracker();
    let metricReads = 0;
    const readLivePids = () => { metricReads += 1; return new Set([200]); };
    assert.deepEqual(table.pollIfTracked(readLivePids, () => true), []);
    assert.equal(metricReads, 0);
    table.observe(1, 2, 200, 'https://a.webview.localhost/?id=akari-preview-abc');
    assert.deepEqual(table.pollIfTracked(readLivePids, () => true), []);
    assert.equal(metricReads, 1);
    table.forgetContents(1);
    assert.deepEqual(table.pollIfTracked(readLivePids, () => true), []);
    assert.equal(metricReads, 1);
});

function harness({ isActive = () => true } = {}) {
    const shown = [];
    const hidden = [];
    const writes = [];
    const timers = [];
    const log = new host.PreviewDiagnosticsLog({
        resolveLogUri: async () => 'file:///tmp/diagnostics.log',
        readText: async () => undefined,
        writeText: async (_uri, text) => writes.push(text),
        warn: () => {}
    });
    const center = new host.PreviewDiagnosticsCenter({
        now: () => 100,
        nowIso: () => '2026-10-06T12:00:00.000Z',
        setTimeout: (callback, ms) => { timers.push({ callback, ms }); return timers.length; },
        clearTimeout: () => {},
        warn: () => {}
    }, log);
    const session = center.register({
        id: 'akari-output-preview-abc', kind: 'output',
        isActive,
        overlay: { show: model => shown.push(model), hide: () => hidden.push(true) }
    });
    return { session, log, shown, hidden, timers, writes };
}

test('renderer 停止は全段 ok 後でも帯・コピー・ログへ同じ理由と時刻を残す', async () => {
    const h = harness();
    for (const stage of ['webview-created', 'model-loaded', 'page-html-set', 'scripts-loaded',
        'engine-initialized', 'media-supplied', 'first-frame']) h.session.markStage(stage, 'ok');
    h.session.rendererGone({ reason: 'oom', exitCode: 137, at: '2026-10-06T12:01:00.000Z' });
    assert.match(h.shown.at(-1).title, /表示処理が停止しました（理由: メモリ不足）/u);
    assert.match(h.shown.at(-1).firstErrorLine, /例外ではなくプロセスの停止/u);
    assert.match(h.shown.at(-1).footerLines.join('\n'), /停止の時点で ok だった段/u);
    assert.doesNotMatch(h.shown.at(-1).footerLines.join('\n'), /止まった段:|停止の時点で未完了だった段:/u);
    assert.equal(h.shown.at(-1).canReopen, true);
    const report = h.session.copyReport();
    assert.match(report, /reason=oom exitCode=137 時刻=2026-10-06T12:01:00.000Z/u);
    assert.doesNotMatch(report, /止まった段:|停止の時点で未完了だった段:/u);
    await h.log.settled();
    const lines = h.writes.at(-1).trim().split('\n').map(JSON.parse);
    const gone = lines.find(line => line.event === 'renderer-gone');
    assert.deepEqual(gone.rendererGone, { reason: 'oom', exitCode: 137, at: '2026-10-06T12:01:00.000Z' });
    assert.equal(gone.at, '2026-10-06T12:01:00.000Z');
    assert.equal(gone.summary.stages.at(-1).status, 'ok');
    h.session.restartPageStages();
    assert.equal(h.session.trace.rendererGone, undefined);
});

test('初期化途中の renderer 停止は未完了段を時点情報として表示する', () => {
    const h = harness();
    for (const stage of ['webview-created', 'model-loaded', 'page-html-set', 'scripts-loaded',
        'engine-initialized']) h.session.markStage(stage, 'ok');
    h.session.rendererGone({ reason: 'crashed', exitCode: 1, at: '2026-10-06T12:02:00.000Z' });
    const report = h.session.copyReport();
    const detail = h.shown.at(-1).footerLines.join('\n');
    assert.match(report, /結果: プレビューの表示処理が停止しました/u);
    assert.match(report, /停止の時点で未完了だった段: メディア供給/u);
    assert.match(detail, /停止の時点で未完了だった段: メディア供給/u);
    assert.doesNotMatch(report, /止まった段:/u);
    assert.doesNotMatch(detail, /止まった段:/u);
});

test('watchdog はプロセス停止と言わず応答なしとして表示する', () => {
    const h = harness();
    h.session.markStage('page-html-set', 'ok');
    h.timers.find(timer => timer.ms === host.PREVIEW_DIAGNOSTICS_WATCHDOG_MS).callback();
    assert.match(h.shown.at(-1).title, /応答していません/u);
    assert.doesNotMatch(h.shown.at(-1).title, /表示処理が停止しました/u);
    assert.match(h.session.copyReport(), /プロセスの停止は未確認/u);
});

test('初回描画後の心拍停止は応答なしになり、再開した心拍で帯が消える', () => {
    const h = harness();
    for (const stage of ['webview-created', 'model-loaded', 'page-html-set', 'scripts-loaded',
        'engine-initialized', 'media-supplied', 'first-frame']) h.session.markStage(stage, 'ok');
    assert.equal(h.timers.at(-1).ms, host.PREVIEW_DIAGNOSTICS_HEARTBEAT_CHECK_MS);
    for (let index = 0; index < 4; index += 1) h.timers.at(-1).callback();
    assert.match(h.shown.at(-1).title, /応答していません/u);
    assert.equal(h.shown.at(-1).canReopen, false);
    assert.doesNotMatch(h.shown.at(-1).title, /止まった段/u);
    h.session.ingest({ type: 'akari-preview-diagnostics', phase: 'heartbeat' });
    assert.equal(h.hidden.length, 1);
    assert.equal(h.timers.at(-1).ms, host.PREVIEW_DIAGNOSTICS_HEARTBEAT_CHECK_MS);
});

test('非表示タブで止まった心拍は無応答の時間に数えない', () => {
    let active = false;
    const h = harness({ isActive: () => active });
    for (const stage of ['webview-created', 'model-loaded', 'page-html-set', 'scripts-loaded',
        'engine-initialized', 'media-supplied', 'first-frame']) h.session.markStage(stage, 'ok');
    for (let index = 0; index < 5; index += 1) h.timers.at(-1).callback();
    assert.deepEqual(h.shown, []);
    active = true;
    for (let index = 0; index < 3; index += 1) h.timers.at(-1).callback();
    assert.deepEqual(h.shown, []);
    h.timers.at(-1).callback();
    assert.match(h.shown.at(-1).title, /応答していません/u);
});

test('停止理由の日本語化と不明な exitCode の記録', async () => {
    const core = require('../lib/common/preview-init-diagnostics.js');
    for (const [reason, label] of Object.entries({
        oom: 'メモリ不足', crashed: '異常終了', killed: '強制終了',
        'abnormal-exit': '異常終了', 'launch-failed': '起動失敗', unknown: '不明'
    })) assert.equal(core.describePreviewRendererGoneReason(reason), label);
    assert.equal(core.describePreviewRendererGoneReason('other'), 'other');
    const h = harness();
    h.session.rendererGone({ reason: 'unknown', exitCode: null, at: '2026-10-06T12:00:00.000Z' });
    assert.match(h.session.copyReport(), /reason=unknown exitCode=不明/u);
    await h.log.settled();
    const line = h.writes.at(-1).trim().split('\n').map(JSON.parse).find(entry => entry.event === 'renderer-gone');
    assert.equal(line.rendererGone.exitCode, null);
});

test('webview は報告件数の上限とは別に低頻度の心拍を送る', () => {
    const page = createPreviewPage();
    page.run(injectedScript('previewDiagnosticsGuardScript'));
    page.attachHost();
    const heartbeat = page.intervals.find(interval => interval.ms === 5000);
    assert.ok(heartbeat);
    heartbeat.handler();
    assert.equal(page.posted.at(-1).phase, 'heartbeat');
});

test('停止帯の開き直すボタンは指定された操作を呼ぶ', () => {
    const elements = [];
    const document = {
        createElement: tag => {
            const element = {
                tag, style: {}, dataset: {}, children: [], listeners: {},
                append(...children) { this.children.push(...children); },
                addEventListener(name, listener) { this.listeners[name] = listener; },
                remove() {}
            };
            elements.push(element);
            return element;
        }
    };
    const node = { ownerDocument: document, children: [], append(child) { this.children.push(child); } };
    let reopened = 0;
    const overlay = host.createDomPreviewDiagnosticsOverlay(node, {
        onCopy: () => {}, onReopen: () => { reopened += 1; }
    });
    overlay.show({ title: '停止', stageLines: [], firstErrorLine: '', reportText: '', footerLines: [], canReopen: true });
    const button = elements.find(element => element.dataset.akariPreviewDiagnostics === 'reopen');
    assert.ok(button);
    button.listeners.click();
    assert.equal(reopened, 1);
});
