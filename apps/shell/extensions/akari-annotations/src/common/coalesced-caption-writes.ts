interface PendingWrite<T, R> {
    key: string;
    value: T;
    waiters: Array<{ resolve(result: R): void; reject(error: unknown): void }>;
}

/** Keep one in-flight write and only the latest unsent value for each field. */
export class CoalescedCaptionWrites<T, R extends { ok: boolean }> {
    private readonly pending: Array<PendingWrite<T, R>> = [];
    private running = false;

    constructor(private readonly write: (value: T) => Promise<R>) {}

    enqueue(key: string, value: T): Promise<R> {
        return new Promise((resolve, reject) => {
            const existing = this.pending.find(entry => entry.key === key);
            if (existing) {
                existing.value = value;
                existing.waiters.push({ resolve, reject });
            } else this.pending.push({ key, value, waiters: [{ resolve, reject }] });
            if (!this.running) void this.drain();
        });
    }

    private async drain(): Promise<void> {
        this.running = true;
        try {
            while (this.pending.length) {
                const entry = this.pending.shift()!;
                let failure: unknown;
                let result: R | undefined;
                try { result = await this.write(entry.value); } catch (error) { failure = error; }
                for (const waiter of entry.waiters) {
                    if (failure !== undefined) waiter.reject(failure);
                    else waiter.resolve(result!);
                }
                if (failure !== undefined || !result?.ok) {
                    for (let index = this.pending.length - 1; index >= 0; index--) {
                        if (this.pending[index].key !== entry.key) continue;
                        const cancelled = this.pending.splice(index, 1)[0];
                        for (const waiter of cancelled.waiters) {
                            if (failure !== undefined) waiter.reject(failure);
                            else waiter.resolve(result!);
                        }
                    }
                }
            }
        } finally { this.running = false; }
    }
}
