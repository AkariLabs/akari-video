export class LiveCaptionEdit {
    private latest: string;
    private saved: string;
    private composing = false;
    private stablePending?: string;
    private timer?: ReturnType<typeof setTimeout>;
    private firstPending?: number;
    private writing?: Promise<void>;
    private stopped = false;

    constructor(readonly original: string, private readonly write: (text: string) => Promise<void>,
        private readonly now: () => number = Date.now) {
        this.latest = original;
        this.saved = original;
    }

    input(value: string, isComposing = false): void {
        if (this.stopped || this.composing || isComposing) return;
        this.latest = value;
        if (!value.trim()) { this.clearTimer(); this.firstPending = undefined; return; }
        this.schedule();
    }

    compositionStart(): void {
        this.stablePending = this.latest;
        this.composing = true;
        this.clearTimer();
        void this.flush().catch(() => undefined);
    }

    compositionEnd(value: string): void {
        this.composing = false;
        this.input(value);
    }

    private schedule(): void {
        if (!this.latest.trim() || this.latest === this.saved) return;
        if (this.firstPending === undefined) this.firstPending = this.now();
        this.clearTimer();
        const delay = Math.max(0, Math.min(150, this.firstPending + 300 - this.now()));
        this.timer = setTimeout(() => { this.timer = undefined; void this.flush().catch(() => undefined); }, delay);
    }

    private clearTimer(): void {
        if (this.timer !== undefined) clearTimeout(this.timer);
        this.timer = undefined;
    }

    async flush(): Promise<void> {
        this.clearTimer();
        if (this.writing) { await this.writing; await this.flush(); return; }
        const hadStable = this.stablePending !== undefined;
        const value = this.stablePending ?? this.latest;
        this.stablePending = undefined;
        if ((this.composing && !hadStable) || !value.trim() || value === this.saved) return;
        this.firstPending = undefined;
        this.writing = this.write(value);
        try { await this.writing; this.saved = value; }
        finally { this.writing = undefined; }
        if (this.stablePending !== undefined || (this.latest !== this.saved && !this.composing)) await this.flush();
    }

    async finish(value: string): Promise<boolean> {
        this.stopped = true;
        this.latest = value;
        this.stablePending = undefined;
        if (!value.trim()) { this.clearTimer(); if (this.writing) await this.writing; return false; }
        await this.flush();
        return value !== this.original;
    }

    async cancel(): Promise<void> {
        this.stopped = true;
        this.clearTimer();
        this.composing = false;
        this.stablePending = undefined;
        this.latest = this.original;
        await this.flush();
    }
}
