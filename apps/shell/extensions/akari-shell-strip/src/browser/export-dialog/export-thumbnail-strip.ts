import * as React from '@theia/core/shared/react';
import { Emitter, Event } from '@theia/core/lib/common';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import {
    AkariExportThumbnailService,
    currentStripIndex,
    ExportThumbnailStrip
} from '../../common/export-thumbnail-protocol';
import { AkariExportSessionService } from '../akari-export-session-service';

let current: AkariExportThumbnailStripStore | undefined;

function setCurrentStore(store: AkariExportThumbnailStripStore): void {
    current = store;
}

@injectable()
export class AkariExportThumbnailStripStore {
    @inject(AkariExportSessionService)
    protected readonly session!: AkariExportSessionService;
    @inject(AkariExportThumbnailService)
    protected readonly thumbnailService!: AkariExportThumbnailService;
    @inject(WorkspaceService)
    protected readonly workspace!: WorkspaceService;

    protected readonly changeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.changeEmitter.event;
    loading = false;
    strip: ExportThumbnailStrip | undefined;
    protected wasRunning = false;
    protected generation = 0;

    constructor() {
        setCurrentStore(this);
    }

    @postConstruct()
    protected init(): void {
        this.session.onDidChange(() => this.handleSessionChange());
        this.handleSessionChange();
    }

    currentIndex(progressPercent: number): number {
        return currentStripIndex(this.strip, progressPercent);
    }

    protected handleSessionChange(): void {
        const phase = this.session.snapshot.status.phase;
        const running = phase === 'linting' || phase === 'rendering';
        if (running && !this.wasRunning) {
            void this.prepareForRun();
        }
        this.wasRunning = running;
    }

    protected async prepareForRun(): Promise<void> {
        const generation = ++this.generation;
        this.loading = true;
        this.strip = undefined;
        this.changeEmitter.fire();
        let projectRootUri: string | undefined;
        try {
            projectRootUri = (await this.workspace.roots)[0]?.resource.toString();
        } catch {
            if (this.generation === generation) {
                this.loading = false;
                this.strip = { durationSeconds: 0, frames: [] };
                this.changeEmitter.fire();
            }
            return;
        }
        if (!projectRootUri) {
            if (this.generation === generation) {
                this.loading = false;
                this.changeEmitter.fire();
            }
            return;
        }
        let strip: ExportThumbnailStrip;
        try {
            strip = await this.thumbnailService.prepareStrip({ projectRootUri, count: 12 });
        } catch {
            strip = { durationSeconds: 0, frames: [] };
        }
        if (this.generation !== generation) {
            return;
        }
        this.loading = false;
        this.strip = strip;
        this.changeEmitter.fire();
    }
}

export function exportThumbnailStripStore(): AkariExportThumbnailStripStore | undefined {
    return current;
}

export function ExportThumbnailStrip(props: { percent: number }): React.ReactNode {
    const store = exportThumbnailStripStore();
    const [, setRevision] = React.useState(0);
    React.useEffect(() => {
        if (!store) return undefined;
        const subscription = store.onDidChange(() => setRevision(value => value + 1));
        return () => subscription.dispose();
    }, [store]);
    const strip = store?.strip;
    if (!store || !strip || strip.frames.length === 0) {
        return null;
    }
    const currentIndex = store.currentIndex(props.percent);
    return React.createElement('div', {
        'data-akari-export-strip': '',
        style: {
            display: 'grid',
            gridTemplateColumns: `repeat(${strip.frames.length}, 1fr)`,
            gap: '3px',
            marginTop: '8px'
        }
    }, strip.frames.map((frame, index) => {
        const isCurrent = index === currentIndex;
        return React.createElement('div', {
            key: `${index}-${frame.outputSeconds}`,
            'data-akari-export-strip-frame': '',
            ...(isCurrent ? { 'data-akari-export-strip-current': 'true' } : {}),
            style: {
                aspectRatio: '16/9',
                borderRadius: '2px',
                background: '#000',
                backgroundImage: frame.dataUrl ? `url("${frame.dataUrl}")` : undefined,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                opacity: isCurrent ? 1 : 0.45,
                outline: isCurrent
                    ? '1.5px solid var(--akari-accent, #f97316)'
                    : '1.5px solid transparent',
                outlineOffset: '-1.5px',
                transition: 'opacity .15s'
            }
        });
    }));
}
