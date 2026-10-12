import { dirname, join } from 'path';

type Job<T> = { run: () => Promise<T>; draftKey?: string; listeners: Array<{
    resolve: (value: T) => void; reject: (error: unknown) => void;
}> };

export class CaptionWriteQueue {
    private readonly files = new Map<string, { active: boolean; jobs: Job<unknown>[] }>();

    run<T>(file: string, operation: () => Promise<T>, draftKey?: string): Promise<T> {
        let state = this.files.get(file);
        if (!state) {
            state = { active: false, jobs: [] };
            this.files.set(file, state);
        }
        return new Promise<T>((resolve, reject) => {
            let listeners: Job<unknown>['listeners'] = [{ resolve: resolve as (value: unknown) => void, reject }];
            if (draftKey) {
                for (let index = state.jobs.length - 1; index >= 0; index--) {
                    const pending = state.jobs[index];
                    if (!pending.draftKey) break;
                    if (pending.draftKey === draftKey) {
                        listeners = [...pending.listeners, ...listeners];
                        state.jobs.splice(index, 1);
                        break;
                    }
                }
            }
            state.jobs.push({ run: operation, draftKey, listeners } as Job<unknown>);
            if (!state.active) void this.drain(file, state);
        });
    }

    private async drain(file: string, state: { active: boolean; jobs: Job<unknown>[] }): Promise<void> {
        state.active = true;
        while (state.jobs.length) {
            const job = state.jobs.shift()!;
            try {
                const value = await job.run();
                for (const listener of job.listeners) listener.resolve(value);
            } catch (error) {
                for (const listener of job.listeners) listener.reject(error);
            }
        }
        state.active = false;
        this.files.delete(file);
    }
}

let sequence = 0;

export function captionTemporaryPath(destination: string, hasAkari: boolean,
    pid = process.pid, random = Math.random): string {
    const folder = hasAkari ? join(dirname(destination), '.akari', 'cache', 'write-tmp') : dirname(destination);
    return join(folder, `${destination.split(/[\\/]/u).pop()}.${pid}.${++sequence}.${random().toString(36).slice(2)}.tmp`);
}
