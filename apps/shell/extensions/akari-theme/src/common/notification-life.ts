export type NotificationKind = 'info' | 'warning' | 'error' | 'progress';

export const NOTIFICATION_LIFE_MS = { plain: 3000, action: 5000, important: 8000 } as const;

/** The sole policy for how long a notification occupies the toast area. */
export function notificationLifeMs(kind: NotificationKind, actions: number, timeout?: number, progress = false): number {
    if (progress || kind === 'progress') return 0;
    if (timeout === 0) return 0;
    if (typeof timeout === 'number' && Number.isFinite(timeout) && timeout > 0) return timeout;
    if (kind === 'error' || kind === 'warning' || actions >= 2) return NOTIFICATION_LIFE_MS.important;
    return actions === 1 ? NOTIFICATION_LIFE_MS.action : NOTIFICATION_LIFE_MS.plain;
}

export interface NotificationOperations {
    /** NotificationManager.hideToast: retain notifications and deferredResults. */
    hideToast(id: string): void;
    /** NotificationManager.accept: remove the notification and resolve its result. */
    accept(id: string, action: string | undefined): void;
}

interface Entry {
    kind: NotificationKind;
    remaining: number;
    total: number;
    holds: Set<string>;
    phase: 'visible' | 'absorbing' | 'stored';
    unread: boolean;
}

/** DOM-free clock and notification-operation policy. A frame gap is never caught up. */
export class NotificationLife {
    private readonly entries = new Map<string, Entry>();
    private lastFrame: number | undefined;

    constructor(private readonly operations?: NotificationOperations) { }

    add(id: string, kind: NotificationKind, life: number): void {
        this.entries.set(id, { kind, remaining: life, total: life, holds: new Set(), phase: 'visible', unread: false });
    }

    remove(id: string): void { this.entries.delete(id); }

    hold(id: string, reason: string, held: boolean): void {
        const entry = this.entries.get(id);
        if (held) entry?.holds.add(reason);
        else entry?.holds.delete(reason);
    }

    get hasCounting(): boolean {
        return [...this.entries.values()].some(entry => entry.phase === 'visible' && entry.total > 0 && !entry.holds.size);
    }

    /** Called by requestAnimationFrame; gaps over 250ms indicate no continuous painting. */
    frame(now: number, hidden = false): string[] {
        const gap = this.lastFrame === undefined ? 0 : Math.max(0, now - this.lastFrame);
        this.lastFrame = now;
        const elapsed = hidden || gap > 250 ? 0 : gap;
        const expired: string[] = [];
        if (!elapsed) return expired;
        for (const [id, entry] of this.entries) {
            if (entry.phase !== 'visible' || entry.total === 0 || entry.holds.size) continue;
            entry.remaining = Math.max(0, entry.remaining - elapsed);
            if (entry.remaining === 0) {
                entry.phase = 'absorbing';
                expired.push(id);
            }
        }
        return expired;
    }

    resetFrame(): void { this.lastFrame = undefined; }
    fraction(id: string): number | undefined {
        const entry = this.entries.get(id);
        return entry?.total ? entry.remaining / entry.total : undefined;
    }

    phase(id: string): Entry['phase'] | undefined { return this.entries.get(id)?.phase; }
    remaining(id: string): number | undefined { return this.entries.get(id)?.remaining; }

    finishAbsorb(id: string, centerOpen: boolean): void {
        const entry = this.entries.get(id);
        if (!entry || entry.phase !== 'absorbing') return;
        entry.phase = 'stored';
        entry.unread = !centerOpen;
        this.operations?.hideToast(id);
    }

    finishDismiss(id: string, action?: string): void { this.operations?.accept(id, action); }
    acceptFromCenter(id: string, action: string): void { this.operations?.accept(id, action); }

    storeWithoutUnread(id: string): void {
        const entry = this.entries.get(id);
        if (entry) {
            entry.phase = 'stored';
            entry.unread = false;
        }
    }

    hideVisible(ids: Iterable<string>): void { for (const id of ids) this.storeWithoutUnread(id); }
    openCenter(): void { for (const entry of this.entries.values()) entry.unread = false; }
    get unreadCount(): number { return [...this.entries.values()].filter(entry => entry.unread).length; }
    get hasUnreadError(): boolean { return [...this.entries.values()].some(entry => entry.unread && entry.kind === 'error'); }
}
