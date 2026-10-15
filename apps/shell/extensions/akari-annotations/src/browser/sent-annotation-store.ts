import { Emitter, Event } from '@theia/core/lib/common';
import { StorageService } from '@theia/core/lib/browser';
import { inject, injectable } from '@theia/core/shared/inversify';

/** Shared with the review panel; the storage key and array format predate preview commands. */
@injectable()
export class SentAnnotationStore {
    @inject(StorageService)
    protected readonly storage!: StorageService;

    protected readonly entries = new Map<string, Promise<Set<string>>>();
    protected readonly changed = new Emitter<string>();
    readonly onDidChange: Event<string> = this.changed.event;

    async read(reviewUri: string): Promise<ReadonlySet<string>> {
        let entry = this.entries.get(reviewUri);
        if (!entry) {
            entry = this.storage.getData<string[]>(`akari-review-sent-annotations:${reviewUri}`, [])
                .then(ids => new Set(Array.isArray(ids) ? ids.filter(id => typeof id === 'string') : []));
            this.entries.set(reviewUri, entry);
        }
        return entry;
    }

    async mark(reviewUri: string, id: string): Promise<void> {
        const ids = new Set(await this.read(reviewUri));
        ids.add(id);
        await this.storage.setData(`akari-review-sent-annotations:${reviewUri}`, [...ids]);
        this.entries.set(reviewUri, Promise.resolve(ids));
        this.changed.fire(reviewUri);
    }
}
