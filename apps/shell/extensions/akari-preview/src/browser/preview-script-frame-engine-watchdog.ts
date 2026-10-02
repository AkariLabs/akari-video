// F-49: akari-preview-open-handler.ts から機械移設した webview 注入スクリプト（テンプレート文字列の本文は無改変）。


export function frameEngineWatchdogScript(): string {
        return `(() => {
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
                        : String(reason || '不明なエラー');
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
                    cause = '最初のエラー: ' + first.message + ' ('
                        + (first.filename || '<inline>') + ':' + first.lineno + ')';
                } else if (typeof window.AkariFrameEngine === 'undefined') {
                    cause = 'frame-engine バンドルが読み込まれていません (window.AkariFrameEngine undefined)';
                } else if (!root) {
                    cause = '初期化スクリプトが実行されていません (#frame-engine-preview 未生成)';
                } else {
                    cause = '初期化が ' + timeout + ' ms 以内に完了しませんでした '
                        + '(data-frame-engine-ready=' + String(root.dataset.frameEngineReady) + ')';
                    const engineError = document.getElementById('frame-engine-error');
                    const engineErrorText = engineError && engineError.textContent
                        ? engineError.textContent.trim()
                        : '';
                    if (engineErrorText) cause += ' / engine エラー: ' + engineErrorText;
                }
                if (errors.length === 0 && rejections.length > 0) {
                    cause += '（未処理の Promise 拒否: ' + rejections[0].message + '）';
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
                text.textContent = 'プレビュー（frame engine）を初期化できませんでした。' + cause;
                const button = document.createElement('button');
                button.id = 'frame-engine-boot-fallback';
                button.className = 'message-card-reload';
                button.type = 'button';
                button.textContent = '旧経路で開き直す';
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
