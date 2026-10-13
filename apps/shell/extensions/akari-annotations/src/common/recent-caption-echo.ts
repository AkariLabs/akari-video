export class RecentCaptionEchoVerifier {
    private timer: ReturnType<typeof setTimeout> | undefined;

    constructor(private readonly verify: () => void,
        private readonly schedule: (callback: () => void, delay: number) => ReturnType<typeof setTimeout> = setTimeout,
        private readonly cancel: (timer: ReturnType<typeof setTimeout>) => void = clearTimeout) {}

    request(writtenAt: number, now = Date.now()): void {
        if (this.timer) this.cancel(this.timer);
        this.timer = this.schedule(() => {
            this.timer = undefined;
            this.verify();
        }, Math.max(0, writtenAt + 1020 - now));
    }

    dispose(): void {
        if (this.timer) this.cancel(this.timer);
        this.timer = undefined;
    }
}
