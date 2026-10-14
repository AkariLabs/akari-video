import { t } from '@akari-video/i18n';
export interface TextOverride { text: string; unsaved: boolean }
export interface DaihonEditAttempt { readonly abandoned: boolean }
export type DaihonUnsavedNoticeEvent = 'show' | 'clear';

export class DaihonUnsavedNotice {
    private active = false;

    update(hasUnsaved: boolean, hasPending: boolean): DaihonUnsavedNoticeEvent | undefined {
        if (!this.active && hasUnsaved) {
            this.active = true;
            return 'show';
        }
        if (this.active && !hasUnsaved && !hasPending) {
            this.active = false;
            return 'clear';
        }
        return undefined;
    }
}

export function decideDaihonCaptionEdit(original: string, value: string, cancelled: boolean):
    { text: string; committed: boolean; emptyRejected: boolean } {
    const emptyRejected = !cancelled && !value.trim();
    const committed = !cancelled && !emptyRejected && value !== original;
    return { text: committed ? value : original, committed, emptyRejected };
}

export class DaihonCaptionEditQueue {
    private tail: Promise<void> = Promise.resolve();
    private readonly overrides = new Map<string, TextOverride & {
        recover: (attempt: DaihonEditAttempt) => Promise<void>;
        beforeWrite?: () => Promise<void>; afterWrite?: () => Promise<void>;
        settled: boolean; revision: number;
    }>();
    private readonly notice = new DaihonUnsavedNotice();
    private revision = 0;

    constructor(private readonly timeoutMs = 15000,
        private readonly onChange: (id: string) => void = () => undefined,
        private readonly onNotice: (event: DaihonUnsavedNoticeEvent) => void = () => undefined,
        private readonly onFailure: (error: unknown) => void = () => undefined) {}

    get(id: string): TextOverride | undefined { return this.overrides.get(id); }
    revisionFor(id: string): number | undefined { return this.overrides.get(id)?.revision; }
    hasPendingVisibleWrite(): boolean {
        return [...this.overrides.values()].some(entry => !entry.settled && !entry.unsaved);
    }
    hasOwnedCaptionChange(): boolean {
        return [...this.overrides.values()].some(entry => !entry.unsaved);
    }

    reconcile(id: string, diskText: string): TextOverride | undefined {
        const entry = this.overrides.get(id);
        if (entry && entry.settled && !entry.unsaved && entry.text === diskText) {
            this.overrides.delete(id);
            this.updateNotice();
            return undefined;
        }
        return entry;
    }

    clearSavedOverride(id: string, revision: number | undefined): boolean {
        const entry = this.overrides.get(id);
        if (entry && entry.revision === revision && entry.settled && !entry.unsaved) {
            this.overrides.delete(id);
            this.updateNotice();
            return true;
        }
        return false;
    }

    read<T>(operation: () => Promise<T>): Promise<T> { return this.enqueue(operation); }

    readUntimed<T>(operation: () => Promise<T>): Promise<T> { return this.enqueue(operation, true, false); }

    after<T>(operation: () => Promise<T>): Promise<T> { return this.enqueue(operation, false); }

    write(id: string, text: string, operation: (attempt: DaihonEditAttempt) => Promise<void>, visible = false,
        afterWrite?: () => Promise<void>, beforeWrite?: () => Promise<void>): Promise<void> {
        let entry = visible ? { text, unsaved: false, recover: operation, beforeWrite, afterWrite,
            settled: false, revision: ++this.revision }
            : undefined;
        if (entry) this.overrides.set(id, entry);
        return this.enqueue(async () => {
            await beforeWrite?.();
            await this.limit(operation);
            await afterWrite?.();
            const current = this.overrides.get(id);
            if (entry && current === entry) {
                current.unsaved = false;
                current.settled = true;
                this.changed(id);
                this.updateNotice();
            }
        }, true, false).catch(error => {
            const current = this.overrides.get(id);
            if (entry ? current === entry : !current) {
                entry ??= { text, unsaved: true, recover: operation, beforeWrite, afterWrite,
                    settled: false, revision: ++this.revision };
                entry.unsaved = true;
                entry.settled = false;
                this.overrides.set(id, entry);
                this.changed(id);
                this.updateNotice();
            }
            try { this.onFailure(error); } catch { /* 通知失敗で行列を止めない。 */ }
            throw error;
        });
    }

    private enqueue<T>(operation: (attempt: DaihonEditAttempt) => Promise<T>, recover = true, timed = true): Promise<T> {
        const result = this.tail.catch(() => undefined).then(async () => {
            if (recover) {
                for (const [id, entry] of this.overrides) {
                    if (!entry.unsaved) continue;
                    await entry.beforeWrite?.();
                    await this.limit(entry.recover);
                    await entry.afterWrite?.();
                    if (this.overrides.get(id) === entry) {
                        entry.unsaved = false;
                        entry.settled = true;
                        this.changed(id);
                        this.updateNotice();
                    }
                }
            }
            return timed ? this.limit(operation) : operation({ abandoned: false });
        });
        this.tail = result.then(() => undefined, () => undefined);
        return result;
    }

    private limit<T>(operation: (attempt: DaihonEditAttempt) => Promise<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            let abandoned = false;
            const attempt: DaihonEditAttempt = { get abandoned() { return abandoned; } };
            const timer = setTimeout(() => {
                abandoned = true;
                reject(new Error(t('transcript.daihonCaptionEditQueue.ui.savingCaptionTimedOutAfterSecondsError')));
            }, this.timeoutMs);
            Promise.resolve().then(() => operation(attempt)).then(value => { clearTimeout(timer); resolve(value); },
                error => { clearTimeout(timer); reject(error); });
        });
    }

    private updateNotice(): void {
        const values = [...this.overrides.values()];
        const event = this.notice.update(values.some(entry => entry.unsaved), values.some(entry => !entry.settled));
        if (event) try { this.onNotice(event); } catch { /* 通知失敗で保存を失敗扱いにしない。 */ }
    }

    private changed(id: string): void {
        try { this.onChange(id); } catch { /* 描画失敗を保存失敗として扱わない。 */ }
    }
}

export class DaihonReloadQueue<T = void> {
    private running = false;
    private queued = false;
    private scheduled = false;
    private waiters: Array<{ resolve: (value: T) => void; reject: (error: unknown) => void }> = [];

    constructor(private readonly reload: () => Promise<T>, private readonly canRun: () => boolean) {}

    request(): Promise<T> {
        this.queued = true;
        const result = new Promise<T>((resolve, reject) => this.waiters.push({ resolve, reject }));
        this.resume();
        return result;
    }

    resume(): void {
        if (!this.queued || this.running || this.scheduled || !this.canRun()) return;
        this.scheduled = true;
        queueMicrotask(() => {
            this.scheduled = false;
            if (!this.queued || this.running || !this.canRun()) return;
            this.queued = false;
            this.running = true;
            const waiters = this.waiters.splice(0);
            void this.reload().then(
                value => waiters.forEach(waiter => waiter.resolve(value)),
                error => waiters.forEach(waiter => waiter.reject(error))
            ).finally(() => {
                this.running = false;
                this.resume();
            });
        });
    }
}

export class DaihonCaptionInput {
    private timer?: ReturnType<typeof setTimeout>;
    private composing = false;
    private closed = false;
    private value: string;
    private firstPending?: number;

    constructor(original: string, private readonly draft: (value: string) => void,
        private readonly now: () => number = () => Date.now(),
        private readonly schedule: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>
            = (callback, delay) => setTimeout(callback, delay),
        private readonly cancelTimer: (timer: ReturnType<typeof setTimeout>) => void
            = timer => clearTimeout(timer)) {
        this.value = original;
    }

    input(value: string, isComposing = false): void {
        if (this.closed || this.composing || isComposing) return;
        this.value = value;
        if (this.timer) this.cancelTimer(this.timer);
        this.timer = undefined;
        if (!value.trim()) { this.firstPending = undefined; return; }
        if (this.firstPending === undefined) this.firstPending = this.now();
        const delay = Math.max(0, Math.min(150, this.firstPending + 300 - this.now()));
        this.timer = this.schedule(() => {
            this.timer = undefined;
            this.firstPending = undefined;
            if (!this.closed && !this.composing && this.value.trim()) this.draft(this.value);
        }, delay);
    }

    compositionStart(): void {
        this.composing = true;
        if (this.timer) this.cancelTimer(this.timer);
        this.timer = undefined;
        this.firstPending = undefined;
    }

    compositionEnd(value: string): void { this.composing = false; this.input(value); }

    close(): void {
        this.closed = true;
        if (this.timer) this.cancelTimer(this.timer);
        this.timer = undefined;
        this.firstPending = undefined;
    }
}

export function shouldReloadDaihonChanges(paths: string[], captionsPath: string, editing: boolean): boolean {
    const meaningful = paths.filter(path => !/(?:^|[\\/])[^\\/]+\.tmp$/u.test(path)
        && !/[\\/]\.akari[\\/]cache[\\/]write-tmp(?:[\\/]|$)/u.test(path));
    return meaningful.length > 0 && !(editing && meaningful.every(path => path === captionsPath));
}
