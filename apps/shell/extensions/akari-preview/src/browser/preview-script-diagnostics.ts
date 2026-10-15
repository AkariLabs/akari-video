// F-49: akari-preview-open-handler.ts から機械移設した webview 注入スクリプト（テンプレート文字列の本文は無改変）。
import {
    PREVIEW_INIT_STAGES,
    createPreviewInitTrace,
    describePreviewRendererGoneReason,
    describeKeyEventConversionFailure,
    formatPreviewInitReport,
    guardedKeyHandler,
    isSuspiciousKeyEventShape,
    markPreviewInitStage,
    neutralizePressureObserver,
    recordPreviewDiagnosticEvent,
    summarizePreviewInit
} from '../common/preview-init-diagnostics';
import { formatPreviewAudioDiagnostics } from '../common/preview-audio-heal';

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
            const uiText = JSON.parse(document.getElementById('akari-preview-text')?.textContent || '{}');
            const t = (key, params = {}) => {
                const language = document.documentElement.lang === 'ja' ? 'ja' : 'en';
                const form = typeof params.n === 'number' ? (language === 'ja' ? 'other' : new Intl.PluralRules(language).select(params.n)) : null;
                const selected = form && uiText[key + '_' + form] !== undefined ? key + '_' + form : key;
                return Object.entries(params).reduce((value, [name, part]) => value.split('{' + name + '}').join(String(part)), uiText[selected] ?? key);
            };
            const STAGES = ${JSON.stringify(PREVIEW_INIT_STAGES)};
            const neutralizePressureObserver = (${neutralizePressureObserver.toString()});
            const createPreviewInitTrace = (${createPreviewInitTrace.toString()});
            const recordPreviewDiagnosticEvent = (${recordPreviewDiagnosticEvent.toString()});
            const markPreviewInitStage = (${markPreviewInitStage.toString().replaceAll(
                `${recordPreviewDiagnosticEvent.name}(`, 'recordPreviewDiagnosticEvent(')});
            const summarizePreviewInit = (${summarizePreviewInit.toString()});
            const describePreviewRendererGoneReason = (${describePreviewRendererGoneReason.toString()});
            const formatPreviewInitReport = (${formatPreviewInitReport.toString()});
            const previewAudioSnapshotFn = (debug, pageId, at) => {
                const supply = debug?.supply || {};
                const gate = supply.gate || {};
                const scheduled = debug?.scheduled || {};
                const prefetch = debug?.prefetch || {};
                return {
                    at, pageId,
                    supply: {
                        phase: supply.phase, gate: { holding: gate.holding, heldMs: gate.heldMs,
                            reason: gate.reason, startSec: gate.startSec },
                        required: supply.required, ready: supply.ready, pendingSidecar: supply.pendingSidecar,
                        failed: supply.failed, noAudio: supply.noAudio, bufferedUntil: supply.bufferedUntil
                    },
                    contextState: debug?.contextState, playing: debug?.playing, rate: debug?.rate,
                    scheduled: { startAtSec: scheduled.startAtSec, itemCount: scheduled.itemCount,
                        speech: scheduled.speech, skipped: scheduled.skipped },
                    prefetch: { pending: prefetch.pending, decodedBytes: prefetch.decodedBytes,
                        overBudget: prefetch.overBudget, windows: prefetch.windows },
                    audioPositionSec: debug?.audioPositionSec, renderedTimelineSec: debug?.renderedTimelineSec,
                    driftMs: debug?.driftMs, outputLatencyMs: debug?.outputLatencyMs
                };
            };
            const updatePreviewAudioDiagnosticsFn = (previous, sample) => {
                const old = previous.latest;
                const events = [...previous.events];
                const gate = sample.supply?.gate || {};
                const oldGate = old?.supply?.gate || {};
                const gateRestarted = oldGate.holding && gate.holding && oldGate.startSec !== gate.startSec;
                const gateStartedAt = gate.holding
                    ? (oldGate.holding && !gateRestarted ? previous.gateStartedAt ?? old?.at : sample.at) : undefined;
                const abnormal = (gate.holding && gate.heldMs >= 300)
                    || sample.supply?.phase === 'degraded' || (sample.supply?.failed?.length || 0) > 0;
                const wasAbnormal = (oldGate.holding && oldGate.heldMs >= 300)
                    || old?.supply?.phase === 'degraded' || (old?.supply?.failed?.length || 0) > 0;
                let changed = false;
                const add = (kind, detail) => { events.push({ at: sample.at, kind, detail }); changed = true; };
                if (!old) add('audio-start');
                if (gateRestarted) add('gate-end', 'generation');
                if (gate.holding && (!oldGate.holding || gateRestarted)) add('gate-start', gate.reason);
                if (gate.holding && gate.heldMs >= 300
                    && !(oldGate.holding && !gateRestarted && oldGate.heldMs >= 300)) add('gate-300ms', gate.reason);
                if (sample.supply?.phase === 'degraded' && old?.supply?.phase !== 'degraded') add('degraded');
                if ((sample.supply?.failed?.length || 0) > (old?.supply?.failed?.length || 0)) add('failed');
                if (abnormal && !wasAbnormal) add('abnormal', gate.reason || sample.supply?.phase);
                // 上限は最後の保持時間に観測間隔を足し、次に再生または必要素材の準備完了を判定する。
                if (oldGate.holding && !gate.holding) add('gate-end',
                    (oldGate.heldMs ?? 0) + Math.max(0, Date.parse(sample.at) - Date.parse(old?.at) || 0) >= 2900
                        ? 'limit'
                        : sample.playing === true || ((sample.supply?.pendingSidecar?.length ?? 0) === 0
                            && (sample.supply?.required || []).every(key => (sample.supply?.ready || []).includes(key)))
                            ? 'ready' : 'generation');
                if (!abnormal && wasAbnormal) add('resolved');
                if (old && old.contextState !== sample.contextState) add('context-state', sample.contextState);
                const episodePending = abnormal ? [...new Set([
                    ...(wasAbnormal ? previous.abnormal?.episodePending || [] : []),
                    ...(sample.supply?.pendingSidecar || [])
                ])] : undefined;
                const episodeFailed = abnormal ? [...new Set([
                    ...(wasAbnormal ? previous.abnormal?.episodeFailed || [] : []),
                    ...(sample.supply?.failed || [])
                ])] : undefined;
                return { record: { latest: sample, abnormal: abnormal ? { ...sample, episodePending, episodeFailed } : previous.abnormal,
                    gateStartedAt,
                    events: events.slice(-20) }, changed };
            };
            const formatPreviewAudioDiagnosticsFn = (${typeof formatPreviewAudioDiagnostics === 'function'
                ? formatPreviewAudioDiagnostics.toString() : '(record, labels) => labels.heading'});
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
            let audioRecord = { events: [] };
            let audioHost;
            const resyncOutstanding = new Set();
            const audioLabels = {
                heading: t('preview.diagnostics.audio.heading'),
                latest: t('preview.diagnostics.audio.latest'),
                abnormal: t('preview.diagnostics.audio.abnormal'),
                events: t('preview.diagnostics.audio.events'),
                host: t('preview.diagnostics.audio.host'),
                pending: t('preview.diagnostics.audio.pending'),
                lastQuery: t('preview.diagnostics.audio.lastQuery'),
                lastUpdate: t('preview.diagnostics.audio.lastUpdate'),
                lastResult: t('preview.diagnostics.audio.lastResult')
            };
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
                title.textContent = t('preview.diagnostics.overlay.previewInitializationDidNotCompleteStalledPrefix')
                    + (blocked ? blocked.label : t('preview.diagnostics.overlay.unknownLabel'));
                const body = document.createElement('pre');
                body.id = 'akari-preview-diagnostics-report';
                Object.assign(body.style, {
                    margin: '8px 0 0', whiteSpace: 'pre-wrap',
                    font: '11px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace'
                });
                body.textContent = formatPreviewInitReport(summary, context()) + '\\n\\n'
                    + formatPreviewAudioDiagnosticsFn(audioRecord, audioLabels, audioHost);
                const copy = document.createElement('button');
                copy.id = 'akari-preview-diagnostics-copy';
                copy.type = 'button';
                copy.textContent = t('preview.diagnostics.overlay.copyDiagnosticsAction');
                Object.assign(copy.style, {
                    marginTop: '8px', border: '1px solid rgba(255,255,255,0.45)', borderRadius: '4px',
                    padding: '3px 10px', background: 'transparent', color: 'inherit',
                    font: 'inherit', cursor: 'pointer'
                });
                copy.addEventListener('click', () => {
                    body.textContent = formatPreviewInitReport(summarizePreviewInit(trace), context()) + '\\n\\n'
                        + formatPreviewAudioDiagnosticsFn(audioRecord, audioLabels, audioHost);
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
                audioSample(debug, pageId, at) {
                    const sample = previewAudioSnapshotFn(debug, pageId, at);
                    const next = updatePreviewAudioDiagnosticsFn(audioRecord, sample);
                    audioRecord = next.record;
                    let changed = next.changed;
                    for (const key of resyncOutstanding) {
                        if ((sample.supply?.ready || []).includes(key)) {
                            audioRecord.events = [...audioRecord.events, { at, kind: 'resync-ready', detail: key }].slice(-20);
                            resyncOutstanding.delete(key);
                            changed = true;
                        }
                    }
                    if (changed && post) {
                        try { post({ type: 'akari-preview-audio-diagnostics', pageId, record: audioRecord }); } catch { /* 診断で再生を止めない */ }
                    }
                },
                audioRecord() { return audioRecord; },
                setAudioHost(host) { audioHost = host; },
                requestAudioResync(keys, pageId) {
                    const at = new Date().toISOString();
                    for (const key of keys) {
                        resyncOutstanding.add(key);
                        audioRecord.events = [...audioRecord.events, { at, kind: 'resync-sent', detail: key }].slice(-20);
                    }
                    if (post) try { post({ type: 'akari-preview-audio-diagnostics', pageId, record: audioRecord }); } catch { /* 再生を止めない */ }
                    if (post) try { post({ type: 'akari-preview-audio-resync', pageId, keys }); } catch { /* 再生を止めない */ }
                },
                postAudioRecord(pageId) {
                    if (post) try { post({ type: 'akari-preview-audio-diagnostics', pageId, record: audioRecord }); } catch { /* 再生を止めない */ }
                },
                report() {
                    return formatPreviewInitReport(summarizePreviewInit(trace), context()) + '\\n\\n'
                        + formatPreviewAudioDiagnosticsFn(audioRecord, audioLabels, audioHost);
                },
                summary() { return summarizePreviewInit(trace); }
            };
            window.__akariPreviewDiag = api;
            api.note(t('preview.diagnostics.overlay.computePressureGuardPrefix') + pressureObserver);
            // 初回描画後もページの JS が動いているかをホストへ伝える。
            // 通常の診断報告の件数上限には含めない。
            window.setInterval(() => {
                if (!post) return;
                try { post({ type: 'akari-preview-diagnostics', phase: 'heartbeat' }); }
                catch { /* 心拍の失敗でプレビューを止めない。 */ }
            }, 5000);

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
                } catch { message = t('preview.diagnostics.webviewCard.couldNotReadMessageError'); }
                recordPreviewDiagnosticEvent(trace, {
                    kind,
                    message: message || t('preview.diagnostics.webviewCard.unknownError'),
                    filename: String(event && event.filename || ''),
                    lineno: Number(event && event.lineno || 0),
                    at: now()
                });
                send({ phase: 'event', event: { kind, message: message || t('preview.diagnostics.webviewCard.unknownError') } });
            };
            window.addEventListener('error', event => record('error', event), true);
            window.addEventListener('unhandledrejection', event => record('rejection', event), true);

            const keyProbe = api.safeKeyHandler(event => {
                if (!isSuspiciousKeyEventShape(event)) return;
                api.recordKeyFailure(event, t('preview.diagnostics.webviewCard.keyEventFailKeycodeConversionObservationOnly'));
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
                    missing.push(t('preview.diagnostics.webviewCard.hostAdapterWindowAkariUpdatelayerlayout'));
                }
                if (typeof window.AkariEditKernel === 'undefined') {
                    missing.push(t('preview.diagnostics.webviewCard.sharedKernelAkarieditkernelLabel'));
                }
                if (initialState().frameEngineEnabled === true && typeof window.AkariFrameEngine === 'undefined') {
                    missing.push(t('preview.diagnostics.webviewCard.frameEngineBundleAkariframeengine'));
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
                    if (id === 'first-frame') {
                        const layerVideos = document.getElementById('preview-layers')
                            ?.querySelectorAll('video[data-akari-layer-id]') || [];
                        const sourced = Array.from(layerVideos).filter(media => media.hasAttribute('src')).length;
                        api.note(t('preview.previewWindow.canvas.videoLayersLayersSrcPrefix') + layerVideos.length + ' / ' + sourced);
                    }
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
                        at: now(), detail: t('preview.diagnostics.webviewCard.notLoadedPrefix') + missing.join(', ')
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
                missing.push(t('preview.diagnostics.webviewCard.hostAdapterWindowAkariUpdatelayerlayout'));
            }
            if (typeof window.AkariEditKernel === 'undefined') missing.push(t('preview.diagnostics.webviewCard.sharedKernelAkarieditkernelLabel'));
            if (initial.frameEngineEnabled === true && typeof window.AkariFrameEngine === 'undefined') {
                missing.push(t('preview.diagnostics.webviewCard.frameEngineBundleAkariframeengine'));
            }
            if (missing.length > 0) {
                diag.fail('scripts-loaded', t('preview.diagnostics.webviewCard.notLoadedPrefix') + missing.join(', '));
                return;
            }
            diag.mark('scripts-loaded');
            if (initial.frameEngineEnabled !== true
                && window.akari && typeof window.akari.applyCutFramingVisual === 'function') {
                diag.mark('engine-initialized');
            }
        })();`;
}
