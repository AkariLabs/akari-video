// F-49: akari-preview-open-handler.ts から機械移設した webview 注入スクリプト（テンプレート文字列の本文は無改変）。


export function frameEngineWatchdogScript(): string {
        return `(() => {
            const uiText = JSON.parse(document.getElementById('akari-preview-text')?.textContent || '{}');
            const t = (key, params = {}) => {
                const language = document.documentElement.lang === 'ja' ? 'ja' : 'en';
                const form = typeof params.n === 'number' ? (language === 'ja' ? 'other' : new Intl.PluralRules(language).select(params.n)) : null;
                const selected = form && uiText[key + '_' + form] !== undefined ? key + '_' + form : key;
                return Object.entries(params).reduce((value, [name, part]) => value.split('{' + name + '}').join(String(part)), uiText[selected] ?? key);
            };
            const initial = window.__akariPreview || {};
            const errors = [];
            const rejections = [];
            const record = (target, type, event) => {
                if (target.length >= 5) return;
                const reason = type === 'rejection' && event && event.reason;
                const message = type === 'error' && event && event.message
                    ? event.message
                    : reason && reason.message
                        ? reason.message
                        : String(reason || t('preview.diagnostics.webviewCard.unknownError'));
                const detail = {
                    message: String(message),
                    filename: String(event && event.filename || ''),
                    lineno: Number(event && event.lineno || 0),
                    colno: Number(event && event.colno || 0)
                };
                target.push(detail);
            };
            const recordError = event => record(errors, 'error', event);
            const recordRejection = event => record(rejections, 'rejection', event);
            window.addEventListener('error', recordError, true);
            window.addEventListener('unhandledrejection', recordRejection, true);

            const isReady = () => {
                if (window.akari && window.akari.frameEngineClock) return true;
                const root = document.getElementById('frame-engine-preview');
                return Boolean(root && root.dataset.frameEngineReady === 'true');
            };
            const clearFailure = () => {
                const card = document.getElementById('frame-engine-boot-error');
                if (card) card.remove();
                delete document.documentElement.dataset.frameEngineBootFailure;
                delete document.documentElement.dataset.frameEngineBootErrors;
            };
            window.addEventListener('akari-frame-engine-ready', () => {
                if (isReady()) clearFailure();
            });

            const configuredTimeout = Number(initial.frameEngineReadyTimeoutMs);
            const timeout = Number.isFinite(configuredTimeout) && configuredTimeout > 0
                ? configuredTimeout
                : 15000;
            window.setTimeout(() => {
                if (isReady()) return;
                const root = document.getElementById('frame-engine-preview');
                let cause;
                if (errors.length > 0) {
                    const first = errors[0];
                    cause = t('preview.frameEngine.watchdog.firstErrorPrefix') + first.message + ' ('
                        + (first.filename || '<inline>') + ':' + first.lineno + ')';
                    // 初期化が catch で受けた失敗は Uncaught にならず errors に入らない。あとから出た別の
                    // 例外が「最初のエラー」になっても、画面に出ている engine の失敗を落とさない。
                    const shownEngineError = document.getElementById('frame-engine-error');
                    const shownEngineErrorText = shownEngineError && shownEngineError.textContent
                        ? shownEngineError.textContent.trim()
                        : '';
                    if (shownEngineErrorText) cause += t('preview.frameEngine.watchdog.engineErrorPrefix') + shownEngineErrorText;
                } else if (typeof window.AkariFrameEngine === 'undefined') {
                    cause = t('preview.frameEngine.watchdog.frameEngineBundleDidNotLoadWindowAkariframeengine');
                } else if (!root) {
                    cause = t('preview.frameEngine.watchdog.initializationScriptDidNotRunFrameEnginePreview');
                } else {
                    cause = t('preview.frameEngine.watchdog.initializationDidNotCompleteWithinPrefix') + timeout + t('preview.frameEngine.watchdog.msPrefix')
                        + '(data-frame-engine-ready=' + String(root.dataset.frameEngineReady) + ')';
                    const engineError = document.getElementById('frame-engine-error');
                    const engineErrorText = engineError && engineError.textContent
                        ? engineError.textContent.trim()
                        : '';
                    if (engineErrorText) cause += t('preview.frameEngine.watchdog.engineErrorPrefix') + engineErrorText;
                }
                if (errors.length === 0 && rejections.length > 0) {
                    cause += t('preview.frameEngine.watchdog.unhandledPromiseRejectionPrefix') + rejections[0].message + t('preview.diagnostics.overlay.closeParen');
                }
                document.documentElement.dataset.frameEngineBootFailure = cause;
                // 初期化段の診断（第11項）へ同じ原因説明を渡す。ここで分かるのは
                // 「エンジン初期化が終わらなかった」までで、灰色の原因の断定ではない。
                if (window.__akariPreviewDiag) {
                    window.__akariPreviewDiag.fail('engine-initialized', cause);
                }
                const allDiagnostics = [
                    ...errors.map(detail => ({ type: 'error', ...detail })),
                    ...rejections.map(detail => ({ type: 'rejection', ...detail }))
                ];
                const diagnostics = {
                    events: allDiagnostics.slice(0, 5),
                    truncated: allDiagnostics.length > 5
                };
                let diagnosticsJson = JSON.stringify(diagnostics);
                while (diagnosticsJson.length > 2000 && diagnostics.events.length > 0) {
                    diagnostics.events.pop();
                    diagnostics.truncated = true;
                    diagnosticsJson = JSON.stringify(diagnostics);
                }
                document.documentElement.dataset.frameEngineBootErrors = diagnosticsJson.slice(0, 2000);
                if (document.getElementById('frame-engine-boot-error')) return;
                const previewMessage = document.getElementById('preview-message');
                if (!previewMessage || !previewMessage.parentElement) return;
                const card = document.createElement('div');
                card.id = 'frame-engine-boot-error';
                card.className = 'message-card';
                card.setAttribute('role', 'alert');
                card.dataset.frameEngineBootError = 'true';
                const text = document.createElement('p');
                text.id = 'frame-engine-boot-error-text';
                text.textContent = t('preview.frameEngine.watchdog.couldNotInitializeFrameEnginePreviewPrefix') + cause;
                const button = document.createElement('button');
                button.id = 'frame-engine-boot-fallback';
                button.className = 'message-card-reload';
                button.type = 'button';
                button.textContent = t('preview.frameEngine.watchdog.reopenLegacyPreviewAction');
                button.addEventListener('click', () => {
                    if (window.akari && typeof window.akari.requestFrameEngineFallback === 'function') {
                        window.akari.requestFrameEngineFallback();
                    }
                });
                card.append(text, button);
                previewMessage.parentElement.append(card);
            }, timeout);
        })();`;
}
