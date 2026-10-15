import { t } from '@akari-video/i18n';
/** Read once per notification burst, and repeat when a change arrives during the read. */
export class CoalescedContentReload {
    private pending = false;
    private running = false;
    private disposed = false;

    constructor(private readonly readAndApply: () => Promise<void>) {}

    request(): void {
        if (this.disposed) return;
        this.pending = true;
        if (!this.running) {
            this.running = true;
            queueMicrotask(() => void this.drain());
        }
    }

    private async drain(): Promise<void> {
        try {
            while (this.pending && !this.disposed) {
                this.pending = false;
                try {
                    await this.readAndApply();
                } catch (error) {
                    console.warn(t('annotations.coalescedContentReload.ui.couldNotRereadChangeNotificationError'), error);
                }
            }
        } finally {
            this.running = false;
            if (this.pending && !this.disposed) this.request();
        }
    }

    dispose(): void {
        this.disposed = true;
        this.pending = false;
    }
}
