import { Disposable, Emitter, Event } from '@theia/core/lib/common';
import { PointedTarget, VibeDockJob } from './vibe-dock-tab';

export type MarkState = 'idle' | 'listening' | 'acting';
export type DockState = 'closed' | 'open' | 'expanded';
export type StatusSource = 'ear' | 'auto' | 'jev' | 'job';
export type StatusTone = 'info' | 'warn' | 'error';
export interface StatusLine {
    line: string;
    tone: StatusTone;
    source?: StatusSource;
    action?: VibeDockJob['action'];
}
export interface LayoutStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

export const LAYOUT_KEY = 'akari.vibeDock.layout';
export const MARK_PRESENTATION: Record<MarkState, { shape: string; line: string; tooltip: string }> = {
    idle: { shape: 'outline', line: '止まっています', tooltip: '止まっています' },
    listening: { shape: 'pulse', line: '聞いています', tooltip: '聞いています' },
    acting: { shape: 'inner-dot', line: 'Jev が動かしています', tooltip: 'Jev が動かしています' }
};
export function widthMode(width: number): 'full' | 'compact' | 'tiny' {
    return width < 240 ? 'tiny' : width < 320 ? 'compact' : 'full';
}

export class VibeDockState {
    readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;
    readonly onDidPressMarkEmitter = new Emitter<void>();
    readonly onDidPressMark: Event<void> = this.onDidPressMarkEmitter.event;
    readonly onDidSubmitNoteEmitter = new Emitter<string>();
    readonly onDidSubmitNote: Event<string> = this.onDidSubmitNoteEmitter.event;
    readonly onDidSubmitInstructionEmitter = new Emitter<{ text: string; mode: 'task' | 'send' }>();
    readonly onDidSubmitInstruction: Event<{ text: string; mode: 'task' | 'send' }> = this.onDidSubmitInstructionEmitter.event;
    readonly onDidChangePointedEmitter = new Emitter<PointedTarget | undefined>();
    readonly pointed: Event<PointedTarget | undefined> = this.onDidChangePointedEmitter.event;

    mark: MarkState = 'idle';
    unavailable: string | undefined;
    layout: DockState = 'closed';
    userHeight: number | undefined;
    pointedTarget: PointedTarget | undefined;
    protected readonly storage: LayoutStorage | undefined;
    protected readonly statuses = new Map<number, StatusLine>();
    protected readonly jobs = new Map<string, VibeDockJob>();
    protected readonly jobOrders = new Map<string, number>();
    protected sequence = 0;

    constructor(storage?: LayoutStorage) {
        this.storage = storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage);
        try {
            const raw = this.storage?.getItem(LAYOUT_KEY);
            if (raw) {
                const saved = JSON.parse(raw) as { state?: unknown; userHeight?: unknown };
                if (saved.state === 'open' || saved.state === 'closed') {
                    this.layout = saved.state;
                    if (typeof saved.userHeight === 'number' && Number.isFinite(saved.userHeight) && saved.userHeight > 0) {
                        this.userHeight = saved.userHeight;
                    }
                }
            }
        } catch { /* An unavailable or damaged store starts at the default layout. */ }
    }

    setLayout(state: DockState): void {
        this.layout = state;
        this.saveLayout();
        this.onDidChangeEmitter.fire();
    }
    setUserHeight(px: number | undefined): void {
        this.userHeight = px !== undefined && Number.isFinite(px) ? px : undefined;
        this.saveLayout();
        this.onDidChangeEmitter.fire();
    }
    pressMark(): void {
        if (this.layout === 'closed') this.setLayout('open');
        this.onDidPressMarkEmitter.fire();
    }
    setMark(mark: MarkState, unavailable?: string): void {
        this.mark = mark;
        this.unavailable = unavailable;
        this.onDidChangeEmitter.fire();
    }
    submitNote(note: string): void { this.onDidSubmitNoteEmitter.fire(note); }
    submitInstruction(text: string, mode: 'task' | 'send'): void {
        if (text.trim()) this.onDidSubmitInstructionEmitter.fire({ text, mode });
    }
    setPointed(target: PointedTarget | undefined): void {
        this.pointedTarget = target;
        this.onDidChangePointedEmitter.fire(target);
        this.onDidChangeEmitter.fire();
    }
    consumePointed(): PointedTarget | undefined {
        const target = this.pointedTarget;
        this.setPointed(undefined);
        return target;
    }

    readonly status = {
        set: (line: string, tone: StatusTone = 'info', source?: StatusSource): Disposable => {
            const id = ++this.sequence;
            this.statuses.set(id, { line, tone, source });
            this.onDidChangeEmitter.fire();
            return Disposable.create(() => {
                if (this.statuses.delete(id)) this.onDidChangeEmitter.fire();
            });
        }
    };
    readonly jobReporter = {
        report: (job: VibeDockJob): Disposable => {
            this.jobs.set(job.id, job);
            this.jobOrders.set(job.id, ++this.sequence);
            this.onDidChangeEmitter.fire();
            return Disposable.create(() => {
                if (this.jobs.get(job.id) === job) {
                    this.jobs.delete(job.id);
                    this.jobOrders.delete(job.id);
                    this.onDidChangeEmitter.fire();
                }
            });
        }
    };

    currentStatus(): StatusLine | undefined {
        const rank: Record<StatusSource, number> = { ear: 1, job: 2, auto: 3, jev: 4 };
        const entries: Array<[number, StatusLine]> = [...this.statuses.entries()];
        const blocked = [...this.jobs.values()]
            .filter(job => job.state === 'blocked' || job.state === 'failed')
            .sort((a, b) => (this.jobOrders.get(b.id) ?? 0) - (this.jobOrders.get(a.id) ?? 0))[0];
        if (blocked) entries.push([this.jobOrders.get(blocked.id) ?? 0, {
            line: [blocked.label, blocked.reason].filter(Boolean).join('・'),
            tone: blocked.state === 'failed' ? 'error' : 'warn', source: 'job', action: blocked.action
        }]);
        else {
            const running = [...this.jobs.values()].filter(job => job.state === 'running').length;
            const queued = [...this.jobs.values()].filter(job => job.state === 'queued').length;
            if (running || queued) entries.push([Math.max(...this.jobOrders.values()), {
                line: [running ? `${running} 件進めています` : '', queued ? `${queued} 件待ち` : ''].filter(Boolean).join('・'),
                tone: 'info', source: 'job'
            }]);
        }
        entries.sort((a, b) => {
            const aError = a[1].tone === 'error' ? 1 : 0;
            const bError = b[1].tone === 'error' ? 1 : 0;
            return bError - aError || (rank[b[1].source!] ?? 0) - (rank[a[1].source!] ?? 0) || b[0] - a[0];
        });
        return entries[0]?.[1];
    }

    protected saveLayout(): void {
        try {
            this.storage?.setItem(LAYOUT_KEY, JSON.stringify({
                state: this.layout === 'expanded' ? 'open' : this.layout,
                userHeight: this.userHeight
            }));
        } catch { /* Storage denial never prevents using the dock. */ }
    }
}
