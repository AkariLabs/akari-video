/** A one-shot visibility gate for a single webview widget. */
export class AkariLazyWebviewResolve {
    private started = false;
    private disposed = false;
    private promise: Promise<void> | undefined;
    private run: (() => Promise<void>) | undefined;
    private isVisible: (() => boolean) | undefined;
    private finish: (() => void) | undefined;

    request(isVisible: () => boolean, run: () => Promise<void>): Promise<void> {
        if (this.disposed) {
            return Promise.resolve();
        }
        if (!this.promise) {
            this.isVisible = isVisible;
            this.run = run;
            this.promise = new Promise<void>((resolve, reject) => {
                this.finish = resolve;
                this.reject = reject;
            });
            this.onVisible();
        }
        return this.promise;
    }

    private reject: ((reason: unknown) => void) | undefined;

    onVisible(): void {
        if (this.started || this.disposed || !this.run || !this.isVisible?.()) {
            return;
        }
        this.started = true;
        try {
            this.run().then(
                () => this.finish?.(),
                error => this.reject?.(error)
            );
        } catch (error) {
            this.reject?.(error);
        }
    }

    dispose(): void {
        this.disposed = true;
        this.run = undefined;
        this.isVisible = undefined;
        if (!this.started) {
            this.finish?.();
        }
    }
}
