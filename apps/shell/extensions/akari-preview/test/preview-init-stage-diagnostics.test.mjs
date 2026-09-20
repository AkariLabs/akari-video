// 不具合メモ 第11項: 出力プレビューが灰色のままで、画面にもログにも何も出なかった。
// ここでは「初期化の各段が失敗したとき、失敗段が診断へ出る」ことを段ごとに失敗注入して見る。
//
// 検査は 3 層:
//   (1) 純粋ロジック（段の状態 → 止まった段・整形本文）
//   (2) ホスト側セッション（段の失敗・監視の時間切れ → 画面モデルと JSON Lines ログ）
//   (3) webview 側ガードスクリプト（段の観測 → 画面カード）
// どの層でも「原因の断定」ではなく「止まった段と最初の例外」までしか書かないことを併せて確認する。

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { createPreviewPage, injectedScript, prepareHtmlSource } from './helpers/preview-diagnostics-page.mjs';

const require = createRequire(import.meta.url);
const core = require('../lib/common/preview-init-diagnostics.js');
const host = require('../lib/browser/preview-diagnostics.js');

const STAGE_IDS = core.PREVIEW_INIT_STAGES.map(stage => stage.id);

function labelOf(id) {
    return core.PREVIEW_INIT_STAGES.find(stage => stage.id === id).label;
}

// ---- (1) 純粋ロジック -------------------------------------------------------

test('段は宣言順に 7 段で、名前と観測側が付いている', () => {
    assert.deepEqual(STAGE_IDS, [
        'webview-created', 'model-loaded', 'page-html-set',
        'scripts-loaded', 'engine-initialized', 'media-supplied', 'first-frame'
    ]);
    for (const stage of core.PREVIEW_INIT_STAGES) {
        assert.ok(stage.label.length > 0, `${stage.id} に名前がない`);
        assert.ok(stage.side === 'host' || stage.side === 'webview');
    }
});

for (const [index, id] of STAGE_IDS.entries()) {
    test(`失敗注入: ${id} が失敗すると止まった段としてその段が出る`, () => {
        const trace = core.createPreviewInitTrace(core.PREVIEW_INIT_STAGES);
        for (const earlier of STAGE_IDS.slice(0, index)) {
            core.markPreviewInitStage(trace, earlier, 'ok', { at: 1 });
        }
        core.markPreviewInitStage(trace, id, 'failed', { at: 2, detail: `${id} の注入失敗` });
        const summary = core.summarizePreviewInit(trace);
        assert.equal(summary.complete, false);
        assert.equal(summary.failedStage.id, id);
        assert.equal(summary.reachedStage?.id, index === 0 ? undefined : STAGE_IDS[index - 1]);
        // 失敗は診断イベントにもなり、最初の例外として残る。
        assert.equal(summary.firstError.kind, 'stage-failure');
        assert.equal(summary.firstError.stage, id);
        const report = core.formatPreviewInitReport(summary, { entry: 'desktop-webview' });
        assert.match(report, new RegExp(`止まった段: ${labelOf(id)}`, 'u'));
        assert.match(report, /\[NG\]/u);
        assert.match(report, /原因の断定ではない/u);
    });

    test(`未到達注入: ${id} が pending のまま止まると止まった段として出る`, () => {
        const trace = core.createPreviewInitTrace(core.PREVIEW_INIT_STAGES);
        for (const earlier of STAGE_IDS.slice(0, index)) {
            core.markPreviewInitStage(trace, earlier, 'ok', { at: 1 });
        }
        const summary = core.summarizePreviewInit(trace);
        assert.equal(summary.complete, false);
        assert.equal(summary.failedStage, undefined);
        assert.equal(summary.stalledStage.id, id);
        assert.match(
            core.formatPreviewInitReport(summary, { entry: 'desktop-webview' }),
            new RegExp(`止まった段: ${labelOf(id)}`, 'u')
        );
    });
}

test('全段 ok なら「全段 ok」と出る（誤警報を出さない）', () => {
    const trace = core.createPreviewInitTrace(core.PREVIEW_INIT_STAGES);
    for (const id of STAGE_IDS) core.markPreviewInitStage(trace, id, 'ok', { at: 1 });
    const summary = core.summarizePreviewInit(trace);
    assert.equal(summary.complete, true);
    assert.match(core.formatPreviewInitReport(summary, { entry: 'desktop-webview' }), /全段 ok/u);
});

test('同一メッセージの診断イベントは畳まれ、上限で止まる', () => {
    const trace = core.createPreviewInitTrace(core.PREVIEW_INIT_STAGES);
    for (let index = 0; index < 5; index += 1) {
        core.recordPreviewDiagnosticEvent(trace, { kind: 'error', message: '同じエラー' });
    }
    for (let index = 0; index < 30; index += 1) {
        core.recordPreviewDiagnosticEvent(trace, { kind: 'note', message: `別 ${index}` });
    }
    const folded = trace.events.find(event => event.message === '同じエラー');
    assert.equal(folded.count, 5);
    assert.equal(trace.events.length, core.PREVIEW_DIAGNOSTIC_EVENT_LIMIT);
    assert.equal(trace.firstError.message, '同じエラー');
});

test('Webview ID から用途を引ける（第12項の所有者未特定 ID 対策）', () => {
    assert.equal(core.describePreviewWebviewRole('akari-output-preview-18rnvma').role, 'output');
    assert.equal(core.describePreviewWebviewRole('akari-preview-abc').role, 'raw');
    assert.equal(core.describePreviewWebviewRole('akari-material-preview').role, 'material');
    const unknown = core.describePreviewWebviewRole('65f60b01-6fe6-403a-a9b2-dca8dea8620b');
    assert.equal(unknown.role, 'unknown');
    assert.match(unknown.label, /この拡張の所有ではない/u);
});

// ---- (2) ホスト側セッション -------------------------------------------------

function createHostHarness({ watchdogMs = 20000 } = {}) {
    const writes = [];
    const shown = [];
    let hidden = 0;
    const log = new host.PreviewDiagnosticsLog({
        resolveLogUri: async () => 'file:///tmp/akari-preview-diagnostics.log',
        readText: async () => undefined,
        writeText: async (uri, text) => { writes.push({ uri, text }); },
        warn: () => {}
    });
    const timers = [];
    const center = new host.PreviewDiagnosticsCenter({
        now: () => 100,
        nowIso: () => '2026-09-18T00:00:00.000Z',
        setTimeout: (handler, ms) => { timers.push({ handler, ms }); return timers.length; },
        clearTimeout: () => {},
        warn: () => {},
        copyText: () => {}
    }, log);
    const session = center.register({
        id: 'akari-output-preview-18rnvma',
        kind: 'output',
        editUri: 'file:///p/edit.json',
        watchdogMs,
        overlay: {
            show: model => shown.push(model),
            hide: () => { hidden += 1; }
        }
    });
    return {
        center, session, log, timers, writes, shown,
        hiddenCount: () => hidden,
        lines: async () => {
            await log.settled();
            const last = writes[writes.length - 1];
            return (last?.text ?? '').split('\n').filter(Boolean).map(line => JSON.parse(line));
        },
        fireWatchdog: () => {
            const armed = timers.find(entry => entry.ms === watchdogMs);
            assert.ok(armed, '監視タイマーが仕掛けられていない');
            armed.handler();
        }
    };
}

test('ホスト側: 段の失敗はその場で画面モデルと診断ログに出る', async () => {
    const harness = createHostHarness();
    harness.session.markStage('webview-created', 'ok');
    harness.session.markStage('model-loaded', 'failed', 'edit.json を読めませんでした');
    assert.equal(harness.shown.length, 1);
    assert.match(harness.shown[0].title, /止まった段: 編集モデル読込/u);
    assert.match(harness.shown[0].reportText, /edit.json を読めませんでした/u);
    assert.match(harness.shown[0].footerLines.join('\n'), /akari-output-preview-18rnvma/u);
    assert.match(harness.shown[0].footerLines.join('\n'), /原因の断定ではありません/u);
    const lines = await harness.lines();
    const failure = lines.find(line => line.event === 'stage' && line.status === 'failed');
    assert.equal(failure.stage, 'model-loaded');
    assert.equal(failure.entry, 'desktop-webview');
    assert.equal(failure.webviewId, 'akari-output-preview-18rnvma');
    assert.equal(failure.webviewRole, '出力プレビュー');
});

test('ホスト側: ページから報告が来ないまま時間切れなら「報告なし」を残す', async () => {
    const harness = createHostHarness();
    harness.session.markStage('webview-created', 'ok');
    harness.session.markStage('model-loaded', 'ok');
    harness.session.markStage('page-html-set', 'ok');
    harness.fireWatchdog();
    assert.equal(harness.shown.length, 1);
    assert.match(harness.shown[0].title, /止まった段: スクリプト読込/u);
    assert.match(harness.shown[0].reportText, /ページ側から診断の報告が届いていません/u);
    const lines = await harness.lines();
    const watchdog = lines.find(line => line.event === 'watchdog');
    assert.equal(watchdog.summary.stalledStage, 'scripts-loaded');
    assert.equal(watchdog.summary.complete, false);
});

test('ホスト側: ページが初回描画まで報告すれば警告を出さずログだけ残す', async () => {
    const harness = createHostHarness();
    for (const id of ['webview-created', 'model-loaded', 'page-html-set']) {
        harness.session.markStage(id, 'ok');
    }
    harness.session.ingest({
        type: 'akari-preview-diagnostics',
        phase: 'ready',
        frameEngine: true,
        assetOrigin: 'http://127.0.0.1:53211',
        userAgent: 'electron-ua',
        pressureObserver: 'removed',
        trace: {
            stages: ['scripts-loaded', 'engine-initialized', 'media-supplied', 'first-frame']
                .map(id => ({ id, status: 'ok' })),
            events: []
        }
    });
    harness.fireWatchdog();
    assert.deepEqual(harness.shown, []);
    const lines = await harness.lines();
    const report = lines.find(line => line.event === 'report');
    assert.equal(report.summary.complete, true);
    assert.equal(report.frameEngine, true);
    assert.equal(report.assetOrigin, 'http://127.0.0.1:53211');
});

test('ホスト側: ページの「止まった」報告は段と最初の例外をそのまま画面へ出す', async () => {
    const harness = createHostHarness();
    for (const id of ['webview-created', 'model-loaded', 'page-html-set']) {
        harness.session.markStage(id, 'ok');
    }
    harness.session.ingest({
        type: 'akari-preview-diagnostics',
        phase: 'stuck',
        frameEngine: true,
        trace: {
            stages: [
                { id: 'scripts-loaded', status: 'ok' },
                { id: 'engine-initialized', status: 'failed', detail: '初期化が 15000 ms 以内に完了しませんでした' }
            ],
            events: [{ kind: 'error', message: 'Failed to construct VideoDecoder' }]
        }
    });
    assert.equal(harness.shown.length, 1);
    assert.match(harness.shown[0].title, /止まった段: エンジン初期化/u);
    assert.match(harness.shown[0].firstErrorLine, /15000 ms 以内に完了しませんでした/u);
    assert.match(harness.shown[0].stageLines.join('\n'), /✕ エンジン初期化/u);
    assert.match(harness.shown[0].stageLines.join('\n'), /✓ スクリプト読込/u);
});

test('ホスト側: 診断ログは JSON Lines で入口を区別し、上限で古い行を捨てる', async () => {
    const harness = createHostHarness();
    harness.center.note('webview 生成: id=65f60b01 用途=akari-preview 以外（この拡張の所有ではない）');
    harness.session.markStage('webview-created', 'ok');
    const lines = await harness.lines();
    assert.ok(lines.length >= 2);
    for (const line of lines) {
        assert.ok(['desktop-webview', 'desktop-host', 'web'].includes(line.entry), JSON.stringify(line));
        assert.ok(typeof line.at === 'string');
    }
    const registered = lines.find(line => line.event === 'webview-registered');
    assert.equal(registered.webviewRole, '出力プレビュー');
    const note = lines.find(line => line.event === 'note' && line.entry === 'desktop-host');
    assert.match(note.message, /所有ではない/u);
    assert.ok(host.PREVIEW_DIAGNOSTICS_LOG_MAX_BYTES > 0);
    assert.equal(host.PREVIEW_DIAGNOSTICS_LOG_RELATIVE_PATH, '.akari/logs/akari-preview-diagnostics.log');
});

test('ホスト側: setHTML のやり直しでページ側の段だけが pending へ戻る', () => {
    const harness = createHostHarness();
    for (const id of STAGE_IDS) harness.session.markStage(id, 'ok');
    harness.session.restartPageStages();
    const summary = core.summarizePreviewInit(harness.session.trace);
    assert.equal(summary.complete, false);
    assert.equal(summary.stalledStage.id, 'scripts-loaded');
    assert.equal(summary.reachedStage.id, 'page-html-set');
});

// ---- (3) webview 側ガードスクリプト ----------------------------------------

const guardScript = injectedScript('previewDiagnosticsGuardScript');
const tailScript = injectedScript('previewDiagnosticsTailScript');

function pageWithGuard(options) {
    const page = createPreviewPage(options);
    page.run(guardScript);
    page.attachHost();
    return page;
}

for (const id of ['scripts-loaded', 'engine-initialized', 'media-supplied', 'first-frame']) {
    test(`webview 側: ${id} の失敗はその場で画面カードに段名を出す`, () => {
        const page = pageWithGuard({ initial: { frameEngineEnabled: true } });
        page.diag().fail(id, `${id} の注入失敗`);
        assert.ok(page.card(), '診断カードが出ていない');
        assert.match(page.cardTitle(), new RegExp(`止まった段: ${labelOf(id)}`, 'u'));
        assert.match(page.cardText(), new RegExp(`${id} の注入失敗`, 'u'));
        assert.match(page.cardText(), /原因の断定ではない/u);
        const posted = page.posted.find(message => message.phase === 'stage' && message.status === 'failed');
        assert.equal(posted.stage, id);
    });
}

test('webview 側: スクリプトが読めていなければ時間切れで未読込のグローバル名を出す', () => {
    const page = pageWithGuard({ initial: { frameEngineEnabled: true } });
    page.fireAlarm();
    assert.ok(page.card());
    assert.match(page.cardTitle(), /止まった段: スクリプト読込/u);
    assert.match(page.cardText(), /frame-engine バンドル \(AkariFrameEngine\)/u);
    assert.match(page.cardText(), /共有カーネル \(AkariEditKernel\)/u);
    assert.ok(page.posted.some(message => message.phase === 'stuck'));
});

test('webview 側: エンジン初期化まで進んで止まった場合はその段を出す（frame-engine 面）', () => {
    const page = pageWithGuard({
        initial: { frameEngineEnabled: true },
        globals: {
            akari: { updateLayerLayout: () => {}, applyCutFramingVisual: () => {} },
            AkariEditKernel: {},
            AkariFrameEngine: {}
        }
    });
    page.probeOnce();
    page.fireAlarm();
    assert.match(page.cardTitle(), /止まった段: エンジン初期化/u);
    assert.match(page.cardText(), /\[ok\] スクリプト読込/u);
});

test('webview 側: 全段到達なら ready を報告し、カードを出さない', () => {
    const page = pageWithGuard({
        initial: { frameEngineEnabled: true },
        globals: {
            akari: {
                updateLayerLayout: () => {},
                applyCutFramingVisual: () => {},
                frameEngineClock: { totalDuration: 12 }
            },
            AkariEditKernel: {},
            AkariFrameEngine: {}
        }
    });
    const engineRoot = page.context.document.createElement('div');
    engineRoot.id = 'frame-engine-preview';
    engineRoot.dataset.frameEngineReady = 'true';
    page.context.document.body.append(engineRoot);
    page.probeOnce();
    assert.equal(page.card(), null, '成功時にカードを出してはいけない');
    const ready = page.posted.find(message => message.phase === 'ready');
    assert.ok(ready, 'ready の報告が無い');
    assert.equal(ready.type, 'akari-preview-diagnostics');
    assert.equal(ready.trace.stages.every(stage => stage.status === 'ok'), true);
    page.fireAlarm();
    assert.equal(page.card(), null);
});

test('webview 側: 旧経路（frame-engine 無効）は bootstrap 完了でエンジン初期化に印が付く', () => {
    const page = pageWithGuard({
        initial: { frameEngineEnabled: false, videoSources: {} },
        globals: {
            akari: { updateLayerLayout: () => {}, applyCutFramingVisual: () => {} },
            AkariEditKernel: {}
        }
    });
    page.run(tailScript);
    const summary = page.diag().summary();
    const byId = Object.fromEntries(summary.stages.map(stage => [stage.id, stage.status]));
    assert.equal(byId['scripts-loaded'], 'ok');
    assert.equal(byId['engine-initialized'], 'ok');
});

test('webview 側: 末尾スクリプトは未読込バンドルを段の失敗として名指しする', () => {
    const page = pageWithGuard({
        initial: { frameEngineEnabled: true },
        globals: { akari: { updateLayerLayout: () => {} }, AkariEditKernel: {} }
    });
    page.run(tailScript);
    assert.match(page.cardTitle(), /止まった段: スクリプト読込/u);
    assert.match(page.cardText(), /frame-engine バンドル \(AkariFrameEngine\)/u);
});

test('webview 側: 例外と未処理拒否は最初の例外として残り、ホストへ渡る', () => {
    const page = pageWithGuard({ initial: { frameEngineEnabled: true } });
    page.context.dispatch('error', { message: 'boom', filename: 'frame-engine.js', lineno: 42 });
    page.context.dispatch('unhandledrejection', { reason: new Error('NotAllowedError: compute-pressure') });
    const summary = page.diag().summary();
    assert.equal(summary.firstError.kind, 'error');
    assert.match(summary.firstError.message, /boom/u);
    assert.ok(summary.events.some(event => event.kind === 'rejection' && /NotAllowedError/u.test(event.message)));
    assert.ok(page.posted.some(message => message.phase === 'event'));
});

test('webview 側: 自分の Webview ID と用途をページが名乗れる', () => {
    const page = pageWithGuard({
        initial: {
            frameEngineEnabled: true,
            editPath: 'file:///p/edit.json',
            diagnostics: {
                webviewId: 'akari-output-preview-18rnvma',
                webviewRole: '出力プレビュー',
                assetOrigin: 'http://127.0.0.1:53211',
                kind: 'output'
            }
        }
    });
    page.fireAlarm();
    assert.match(page.cardText(), /akari-output-preview-18rnvma/u);
    assert.match(page.cardText(), /出力プレビュー/u);
    assert.match(page.cardText(), /入口: desktop-webview/u);
    assert.match(page.cardText(), /http:\/\/127\.0\.0\.1:53211/u);
    assert.match(page.cardText(), /file:\/\/\/p\/edit\.json/u);
});

test('prepareHtml はページへ Webview ID と用途と配信オリジンを渡す', () => {
    const html = prepareHtmlSource();
    assert.match(html, /diagnostics: \{/u);
    assert.match(html, /webviewId: pageDiagnostics\.webviewId/u);
    assert.match(html, /webviewRole: pageDiagnostics\.webviewRole/u);
    assert.match(html, /assetOrigin: pageDiagnostics\.assetOrigin/u);
    assert.match(html, /this\.previewDiagnosticsTailScript\(\)/u);
});
