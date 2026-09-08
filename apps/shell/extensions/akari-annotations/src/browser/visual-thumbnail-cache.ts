import type { VisualThumbnailCapture } from 'akari-preview/lib/common/visual-thumbnail';

export interface VisualThumbnailJob {
    key: string;
    priority: number;
    wanted(): boolean;
    valid?(): boolean;
    capture(): Promise<VisualThumbnailCapture>;
}

/** Bounded LRU and visible-first, single-flight work queue. It never owns DOM/renderers. */
export class VisualThumbnailCache {
    readonly stats = { captures: 0, hits: 0, failures: 0, discarded: 0, generatedMs: 0 };
    private readonly cache = new Map<string, VisualThumbnailCapture | null>();
    private readonly queue = new Map<string, VisualThumbnailJob>();
    private readonly wantedByKey = new Map<string, () => boolean>();
    private readonly retries = new Map<string, { attempts: number; deadline: number; at: number }>();
    private active: string | undefined;
    private bytes = 0;
    private paused = false;
    private disposed = false;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private timerAt = 0;

    constructor(private readonly changed: () => void, readonly maxEntries = 96,
        readonly maxBytes = 24 * 1024 * 1024, readonly maxQueued = 32) { }

    get size(): number { return this.cache.size; }
    get queued(): number { return this.queue.size; }
    get memoryBytes(): number { return this.bytes; }
    get isPaused(): boolean { return this.paused || this.disposed; }

    request(job: VisualThumbnailJob): VisualThumbnailCapture | null | undefined {
        if (this.cache.has(job.key)) {
            const value = this.cache.get(job.key)!;
            this.cache.delete(job.key); this.cache.set(job.key, value);
            this.wantedByKey.set(job.key, job.wanted);
            this.stats.hits++;
            const retry = this.retries.get(job.key);
            if (value === null && this.active !== job.key && retry && retry.at <= retry.deadline && Date.now() <= retry.deadline) {
                this.enqueue(job);
            }
            return value;
        }
        if (this.disposed || this.active === job.key) return undefined;
        this.enqueue(job);
        return undefined;
    }

    private enqueue(job: VisualThumbnailJob): void {
        this.queue.set(job.key, job);
        if (this.queue.size > this.maxQueued) {
            const worst = [...this.queue.values()].sort((a, b) => b.priority - a.priority)[0];
            this.queue.delete(worst.key);
        }
        this.schedule();
    }

    setPaused(paused: boolean): void { this.paused = paused; if (!paused) this.schedule(); }

    dispose(): void {
        this.disposed = true;
        if (this.timer) clearTimeout(this.timer);
        this.queue.clear(); this.cache.clear(); this.wantedByKey.clear(); this.retries.clear(); this.bytes = 0;
    }

    private schedule(): void {
        if (this.isPaused || this.active || !this.queue.size) return;
        const next = Math.min(...[...this.queue.keys()].map(key => this.retries.get(key)?.at ?? 0));
        const at = Math.max(Date.now() + 100, next);
        if (this.timer && this.timerAt <= at) return;
        if (this.timer) clearTimeout(this.timer);
        this.timerAt = at;
        this.timer = setTimeout(() => { this.timer = undefined; void this.drain(); }, at - Date.now());
    }

    private async drain(): Promise<void> {
        if (this.isPaused || this.active) return;
        for (const [key, entry] of this.queue) {
            const retry = this.retries.get(key);
            if (!entry.wanted() || entry.valid?.() === false || (retry && Date.now() > retry.deadline)) this.queue.delete(key);
        }
        const job = [...this.queue.values()].filter(entry => (this.retries.get(entry.key)?.at ?? 0) <= Date.now())
            .sort((a, b) => a.priority - b.priority)[0];
        if (!job) { this.schedule(); return; }
        // Keep visible images pinned. Dense views show names for the remaining clips;
        // they must not continually evict and recapture each other on every redraw.
        if (!this.cache.has(job.key) && (this.cache.size >= this.maxEntries || this.bytes > this.maxBytes - Math.min(2 * 1024 * 1024, this.maxBytes / 4))
            && this.cache.size > 0 && [...this.wantedByKey.values()].every(wanted => wanted())) return;
        this.queue.delete(job.key); this.active = job.key;
        const start = performance.now();
        let value: VisualThumbnailCapture | null = null;
        let transient = false;
        try { value = await job.capture(); this.stats.captures++; }
        catch (error) {
            this.stats.failures++;
            transient = /busy|timed?\s*out|timeout|temporar|ECONNRESET|ERR_(CONNECTION|NETWORK)/i.test(String(error));
        }
        this.stats.generatedMs += performance.now() - start;
        this.active = undefined;
        if (this.disposed) return;
        if (job.valid?.() === false) {
            this.stats.discarded++;
            this.changed(); this.schedule(); return;
        }
        const previous = this.retries.get(job.key);
        if (transient) {
            const attempts = (previous?.attempts ?? 0) + 1;
            const deadline = previous?.deadline ?? Date.now() + 30000;
            const at = attempts < 3 ? Date.now() + 1000 * 2 ** (attempts - 1) : Infinity;
            this.retries.set(job.key, { attempts, deadline, at });
            if (at <= deadline) this.queue.set(job.key, job);
        } else this.retries.delete(job.key);
        // Account UTF-16 strings plus the decoded RGBA bitmap at the maximum capture size.
        const cost = (key: string, data: VisualThumbnailCapture | null): number => key.length * 2 + (data ? data.image.length * 2 + 480 * 320 * 4 : 0);
        if (cost(job.key, value) > this.maxBytes) value = null;
        if (this.cache.has(job.key)) this.bytes -= cost(job.key, this.cache.get(job.key)!);
        this.cache.set(job.key, value); this.bytes += cost(job.key, value);
        this.wantedByKey.set(job.key, job.wanted);
        while (this.cache.size > this.maxEntries || this.bytes > this.maxBytes) {
            const key = this.cache.keys().next().value as string;
            this.bytes -= cost(key, this.cache.get(key)!); this.cache.delete(key);
            this.wantedByKey.delete(key);
            this.retries.delete(key); this.queue.delete(key);
        }
        this.changed();
        this.schedule();
    }
}
