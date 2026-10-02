// F-49: akari-preview-open-handler.ts から機械移設した webview 注入スクリプト（テンプレート文字列の本文は無改変）。
import {
    PREVIEW_INIT_STAGES,
    createPreviewInitTrace,
    describeKeyEventConversionFailure,
    formatPreviewInitReport,
    guardedKeyHandler,
    isSuspiciousKeyEventShape,
    markPreviewInitStage,
    neutralizePressureObserver,
    recordPreviewDiagnosticEvent,
    summarizePreviewInit
} from '../common/preview-init-diagnostics';

/**
 * 第13項のガードと、初期化段の診断（第11・12項）。**どのバンドルよりも先に**走る。
 *
 * このスクリプトがやること:
 *  1. `PressureObserver` のグローバルを外す（WebAV 1.2.8 の未処理拒否を発生させない）。
 *     `node_modules/@webav/internal-utils/src/log.ts` は `"PressureObserver" in globalThis` の
 *     存在確認だけで `.observe("cpu")` を呼び、Promise 拒否を捕捉していない。任意の負荷監視なので
 *     監視なしで継続すれば十分で、権限（compute-pressure）は**広げない**
 *  2. `error` / `unhandledrejection` の最初の数件を保持する
 *  3. 段（スクリプト読込 → エンジン初期化 → メディア供給 → 初回描画）を DOM/グローバルから観測する
 *  4. 初回描画まで到達しないまま時間切れになったら、画面に段と最初の例外を出す
 *  5. ホスト（シェル）側へ報告し、`~/.akari/logs/akari-preview-diagnostics.log` に残させる
 *
 * `acquireVsCodeApi()` は 1 ページ 1 回しか呼べないため、ここでは呼ばない。
 * hostAdapterScript が取得したものを `attachHost` で受け取り、それまでの報告は queue に貯める。
 */
export function previewDiagnosticsGuardScript(): string {
        return `(() => {
            const STAGES = ${JSON.stringify(PREVIEW_INIT_STAGES)};
            const neutralizePressureObserver = (${neutralizePressureObserver.toString()});
            const createPreviewInitTrace = (${createPreviewInitTrace.toString()});
            const recordPreviewDiagnosticEvent = (${recordPreviewDiagnosticEvent.toString()});
            const markPreviewInitStage = (${markPreviewInitStage.toString().replaceAll(
                `${recordPreviewDiagnosticEvent.name}(`, 'recordPreviewDiagnosticEvent(')});
            const summarizePreviewInit = (${summarizePreviewInit.toString()});
            const formatPreviewInitReport = (${formatPreviewInitReport.toString()});
            const describeKeyEventConversionFailure = (${describeKeyEventConversionFailure.toString()});
            const isSuspiciousKeyEventShape = (${isSuspiciousKeyEventShape.toString()});
            const guardedKeyHandler = (${guardedKeyHandler.toString()});

            // 1. 第13項のガード。ここより後に読まれる frame-engine バンドル（WebAV 同梱）は
            //    存在確認が偽になるので observe("cpu") へ進まない。
            const pressureObserver = neutralizePressureObserver(globalThis);

            const trace = createPreviewInitTrace(STAGES);
            const now = () => {
                try { return Math.round(performance.now()); } catch { return Date.now(); }
            };
            // このスクリプトが走っている = ホスト側の 3 段（Webview 生成 / 編集モデル読込 /
            // ページ HTML 設定）は既に通っている。ページ側が判断するのはこれより後の段だけ。
            for (const reached of ['webview-created', 'model-loaded', 'page-html-set']) {
                markPreviewInitStage(trace, reached, 'ok', { at: now() });
            }
            const initialState = () => window.__akariPreview || {};
            const queue = [];
            let post = null;
            let posted = 0;
            let settled = false;
            let cardShown = false;
            let keyFailures = 0;
            const send = message => {
                if (posted >= 40) return;
                posted += 1;
                const payload = {
                    type: 'akari-preview-diagnostics',
                    frameEngine: initialState().frameEngineEnabled === true,
                    assetOrigin: (initialState().diagnostics || {}).assetOrigin || null,
                    userAgent: String(navigator && navigator.userAgent || ''),
                    pressureObserver: pressureObserver,
                    ...message
                };
                if (post) { try { post(payload); } catch { /* 報告の失敗で本筋を止めない */ } return; }
                if (queue.length < 20) queue.push(payload);
            };
            const context = () => {
                const declared = initialState().diagnostics || {};
                return {
                    entry: 'desktop-webview',
                    webviewId: declared.webviewId || undefined,
                    webviewRole: declared.webviewRole || undefined,
                    editUri: initialState().editPath || undefined,
                    frameEngine: initialState().frameEngineEnabled === true,
                    assetOrigin: declared.assetOrigin || undefined,
                    userAgent: String(navigator && navigator.userAgent || ''),
                    at: new Date().toISOString()
                };
            };

            // 4. 画面表示。ページ本体の CSS に依存せずインラインスタイルだけで組む。
            const showCard = summary => {
                const host = document.body || document.documentElement;
                if (!host) return;
                const existing = document.getElementById('akari-preview-diagnostics-card');
                if (existing) existing.remove();
                const card = document.createElement('div');
                card.id = 'akari-preview-diagnostics-card';
                card.setAttribute('role', 'alert');
                card.dataset.akariPreviewDiagnostics = 'card';
                Object.assign(card.style, {
                    position: 'fixed', zIndex: '2147483000', left: '0', right: '0', top: '0',
                    maxHeight: '70vh', overflow: 'auto', padding: '12px 14px',
                    background: 'rgba(28,10,10,0.96)', color: '#ffecec',
                    font: '12px/1.6 system-ui, sans-serif', textAlign: 'left'
                });
                const blocked = summary.failedStage || summary.stalledStage;
                const title = document.createElement('strong');
                title.id = 'akari-preview-diagnostics-title';
                title.textContent = 'プレビューの初期化が完了しません — 止まった段: '
                    + (blocked ? blocked.label : '不明');
                const body = document.createElement('pre');
                body.id = 'akari-preview-diagnostics-report';
                Object.assign(body.style, {
                    margin: '8px 0 0', whiteSpace: 'pre-wrap',
                    font: '11px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace'
                });
                body.textContent = formatPreviewInitReport(summary, context());
                const copy = document.createElement('button');
                copy.id = 'akari-preview-diagnostics-copy';
                copy.type = 'button';
                copy.textContent = '診断をコピー';
                Object.assign(copy.style, {
                    marginTop: '8px', border: '1px solid rgba(255,255,255,0.45)', borderRadius: '4px',
                    padding: '3px 10px', background: 'transparent', color: 'inherit',
                    font: 'inherit', cursor: 'pointer'
                });
                copy.addEventListener('click', () => {
                    const text = body.textContent || '';
                    try {
                        if (navigator.clipboard && navigator.clipboard.writeText) {
                            navigator.clipboard.writeText(text).catch(() => { /* 手動選択で持ち出せる */ });
                        }
                    } catch { /* 手動選択で持ち出せる */ }
                    try {
                        const selection = window.getSelection();
                        const range = document.createRange();
                        range.selectNodeContents(body);
                        selection.removeAllRanges();
                        selection.addRange(range);
                    } catch { /* 選択できなくても本文は読める */ }
                });
                card.append(title, body, copy);
                host.append(card);
                cardShown = true;
            };
            const hideCard = () => {
                const existing = document.getElementById('akari-preview-diagnostics-card');
                if (existing) existing.remove();
                cardShown = false;
            };

            const api = {
                trace,
                stages: STAGES,
                pressureObserver,
                mark(stage, detail) {
                    markPreviewInitStage(trace, stage, 'ok', { at: now(), detail });
                    send({ phase: 'stage', stage, status: 'ok', detail: detail || undefined });
                },
                fail(stage, detail) {
                    const text = detail === undefined || detail === null ? '' : String(detail);
                    markPreviewInitStage(trace, stage, 'failed', { at: now(), detail: text });
                    send({ phase: 'stage', stage, status: 'failed', detail: text });
                    showCard(summarizePreviewInit(trace));
                },
                note(message) {
                    recordPreviewDiagnosticEvent(trace, {
                        kind: 'note', message: String(message), at: now()
                    });
                },
                // 第12項: キー変換失敗を安全に無視しつつ形だけ残す。上限を付けて Console も診断も埋めない。
                recordKeyFailure(event, reason) {
                    const described = describeKeyEventConversionFailure(event, reason);
                    recordPreviewDiagnosticEvent(trace, {
                        kind: 'key-conversion', message: described.message, at: now()
                    });
                    keyFailures += 1;
                    if (keyFailures <= 5) {
                        send({ phase: 'event', event: { kind: 'key-conversion', message: described.message } });
                    }
                },
                safeKeyHandler(handler) {
                    return guardedKeyHandler(handler, (event, reason) => api.recordKeyFailure(event, reason));
                },
                attachHost(vscode) {
                    if (!vscode || typeof vscode.postMessage !== 'function') return;
                    post = message => vscode.postMessage(message);
                    const pending = queue.splice(0, queue.length);
                    for (const message of pending) {
                        try { post(message); } catch { /* 報告の失敗で本筋を止めない */ }
                    }
                },
                report() {
                    return formatPreviewInitReport(summarizePreviewInit(trace), context());
                },
                summary() { return summarizePreviewInit(trace); }
            };
            window.__akariPreviewDiag = api;
            api.note('compute-pressure ガード: ' + pressureObserver);

            // 2. 例外の保持。原因の断定はせず、最初の数件を残す。
            const record = (kind, event) => {
                let message = '';
                try {
                    if (kind === 'rejection') {
                        const reason = event && event.reason;
                        message = reason && reason.message ? reason.message : String(reason);
                    } else {
                        message = event && event.message ? event.message : String(event && event.error || '');
                    }
                } catch { message = '(メッセージの取得に失敗)'; }
                recordPreviewDiagnosticEvent(trace, {
                    kind,
                    message: message || '不明なエラー',
                    filename: String(event && event.filename || ''),
                    lineno: Number(event && event.lineno || 0),
                    at: now()
                });
                send({ phase: 'event', event: { kind, message: message || '不明なエラー' } });
            };
            window.addEventListener('error', event => record('error', event), true);
            window.addEventListener('unhandledrejection', event => record('rejection', event), true);

            const keyProbe = api.safeKeyHandler(event => {
                if (!isSuspiciousKeyEventShape(event)) return;
                api.recordKeyFailure(event, 'KeyCode 変換が落ちうる形のキーイベント（観測のみ）');
            });
            window.addEventListener('keydown', keyProbe, true);
            window.addEventListener('keyup', keyProbe, true);

            // 3. 段の観測。巨大な bootstrap テンプレートへ手を入れずに済むよう、
            //    DOM とグローバルの「見えている事実」だけで判定する。
            const stageOf = id => trace.stages.find(stage => stage.id === id);
            const missingGlobals = () => {
                const missing = [];
                if (!window.__akariPreview) missing.push('window.__akariPreview');
                if (!window.akari || typeof window.akari.updateLayerLayout !== 'function') {
                    missing.push('ホストアダプタ (window.akari.updateLayerLayout)');
                }
                if (typeof window.AkariEditKernel === 'undefined') {
                    missing.push('共有カーネル (AkariEditKernel)');
                }
                if (initialState().frameEngineEnabled === true && typeof window.AkariFrameEngine === 'undefined') {
                    missing.push('frame-engine バンドル (AkariFrameEngine)');
                }
                return missing;
            };
            const engineRoot = () => document.getElementById('frame-engine-preview');
            const noPrimaryMedia = () => {
                const state = initialState();
                const sources = state.videoSources || {};
                return Object.keys(sources).length === 0 && state.primaryIsStillImage !== true;
            };
            const probes = {
                'scripts-loaded': () => missingGlobals().length === 0,
                'engine-initialized': () => initialState().frameEngineEnabled === true
                    ? engineRoot() !== null
                    : Boolean(window.akari && typeof window.akari.applyCutFramingVisual === 'function'),
                'media-supplied': () => {
                    if (initialState().frameEngineEnabled === true) {
                        const clock = window.akari && window.akari.frameEngineClock;
                        return Boolean(clock) && Number.isFinite(clock.totalDuration);
                    }
                    if (noPrimaryMedia()) return true;
                    const video = document.getElementById('preview-video');
                    const still = document.getElementById('preview-still');
                    return Boolean(video && video.readyState >= 1)
                        || Boolean(still && still.complete && still.naturalWidth > 0);
                },
                'first-frame': () => {
                    if (initialState().frameEngineEnabled === true) {
                        const root = engineRoot();
                        return Boolean(root) && root.dataset.frameEngineReady === 'true';
                    }
                    const stage = document.getElementById('preview-stage');
                    if (!stage || !(stage.clientWidth > 0)) return false;
                    if (noPrimaryMedia()) return true;
                    const video = document.getElementById('preview-video');
                    const still = document.getElementById('preview-still');
                    return Boolean(video && video.readyState >= 2)
                        || Boolean(still && still.complete && still.naturalWidth > 0);
                }
            };
            const probe = () => {
                for (const id of ['scripts-loaded', 'engine-initialized', 'media-supplied', 'first-frame']) {
                    const stage = stageOf(id);
                    if (!stage || stage.status === 'ok') continue;
                    let reached = false;
                    try { reached = probes[id]() === true; } catch { reached = false; }
                    if (!reached) break;
                    markPreviewInitStage(trace, id, 'ok', { at: now() });
                }
                const summary = summarizePreviewInit(trace);
                if (summary.complete && !settled) {
                    settled = true;
                    if (cardShown) hideCard();
                    send({ phase: 'ready', trace });
                }
                return summary;
            };
            const interval = window.setInterval(() => {
                const summary = probe();
                if (summary.complete) window.clearInterval(interval);
            }, 250);
            window.addEventListener('akari-frame-engine-ready', () => probe());

            // 監視の既定は 18 秒。frame-engine 側の watchdog（既定 15 秒）より後に鳴らし、
            // あちらの原因説明を取り込んでから画面に出す。設定でそれより長い場合は一度だけ延長する。
            let extended = false;
            const alarm = () => {
                const summary = probe();
                if (summary.complete) return;
                const configured = Number(initialState().frameEngineReadyTimeoutMs);
                if (!extended && Number.isFinite(configured) && configured > 15000) {
                    extended = true;
                    window.setTimeout(alarm, configured + 3000 - 18000);
                    return;
                }
                const missing = missingGlobals();
                if (missing.length > 0 && stageOf('scripts-loaded').status !== 'ok') {
                    markPreviewInitStage(trace, 'scripts-loaded', 'failed', {
                        at: now(), detail: '未読込: ' + missing.join(', ')
                    });
                }
                const final = summarizePreviewInit(trace);
                showCard(final);
                send({ phase: 'stuck', trace });
            };
            window.setTimeout(alarm, 18000);
        })();`;
}

/**
 * すべてのバンドルの後に走る一行。ここへ到達していれば同期スクリプトは全部走り切っている。
 * 旧経路（frame-engine 無効）では previewBootstrapScript の完了がそのまま
 * 「エンジン初期化」なので、同時に印を付ける。
 */
export function previewDiagnosticsTailScript(): string {
        return `(() => {
            const diag = window.__akariPreviewDiag;
            if (!diag) return;
            const initial = window.__akariPreview || {};
            const missing = [];
            if (!window.akari || typeof window.akari.updateLayerLayout !== 'function') {
                missing.push('ホストアダプタ (window.akari.updateLayerLayout)');
            }
            if (typeof window.AkariEditKernel === 'undefined') missing.push('共有カーネル (AkariEditKernel)');
            if (initial.frameEngineEnabled === true && typeof window.AkariFrameEngine === 'undefined') {
                missing.push('frame-engine バンドル (AkariFrameEngine)');
            }
            if (missing.length > 0) {
                diag.fail('scripts-loaded', '未読込: ' + missing.join(', '));
                return;
            }
            diag.mark('scripts-loaded');
            if (initial.frameEngineEnabled !== true
                && window.akari && typeof window.akari.applyCutFramingVisual === 'function') {
                diag.mark('engine-initialized');
            }
        })();`;
}
