import { injectable } from '@theia/core/shared/inversify';
import { WebviewWidget } from '@theia/plugin-ext/lib/main/browser/webview/webview';
import {
    AkariWebviewRestyleScheduler, RESTYLE_DEBOUNCE_MS, RESTYLE_HEARTBEAT_MS
} from './akari-webview-restyle-scheduler';

@injectable()
export class AkariWebviewWidget extends WebviewWidget {
    private readonly restyleScheduler = new AkariWebviewRestyleScheduler();
    private restyleTimeout: number | undefined;

    // 親の @postConstruct がこの override を呼ぶ。親の初期化も一度だけ行う。
    protected override init(): void {
        super.init();
        this.toDispose.push(this.onDidChangeVisibility(visible => {
            if (visible) {
                this.scheduleRestyle();
            }
        }));
        const onFocus = () => this.scheduleRestyle();
        window.addEventListener('focus', onFocus);
        const heartbeat = window.setInterval(() => {
            if (!this.isDisposed && this.restyleScheduler.takeHeartbeat(performance.now(), this.isVisible)) {
                this.style();
            }
        }, RESTYLE_HEARTBEAT_MS);
        this.toDispose.push({ dispose: () => {
            window.clearInterval(heartbeat);
            window.clearTimeout(this.restyleTimeout);
            window.removeEventListener('focus', onFocus);
        } });
    }

    protected override doUpdateContent(): void {
        super.doUpdateContent();
        this.scheduleRestyle();
    }

    private scheduleRestyle(): void {
        if (this.isDisposed) {
            return;
        }
        this.restyleScheduler.requestEvent(performance.now());
        window.clearTimeout(this.restyleTimeout);
        this.restyleTimeout = window.setTimeout(() => {
            this.restyleTimeout = undefined;
            if (!this.isDisposed && this.restyleScheduler.takeEvent(performance.now(), this.isVisible)) {
                // 親の doSend が ready を待ち、element が無い場合は no-op になる。
                this.style();
            }
        }, RESTYLE_DEBOUNCE_MS);
    }
}
