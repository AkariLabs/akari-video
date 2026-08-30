export interface KeyValueStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

export class TimelineCollapsedState {
    constructor(
        readonly projectId: string,
        protected readonly storage: KeyValueStorage = localStorage
    ) {}

    key(itemId: string): string {
        return `akari.timeline.collapsed.v1:${this.projectId}:${itemId}`;
    }

    has(itemId: string): boolean {
        return this.storage.getItem(this.key(itemId)) === '1';
    }

    set(itemId: string, collapsed: boolean): void {
        if (collapsed) this.storage.setItem(this.key(itemId), '1');
        else this.storage.removeItem(this.key(itemId));
    }

    toggle(itemId: string): boolean {
        const next = !this.has(itemId);
        this.set(itemId, next);
        return next;
    }

    snapshot(itemIds: Iterable<string>): Set<string> {
        return new Set([...itemIds].filter(id => this.has(id)));
    }
}
