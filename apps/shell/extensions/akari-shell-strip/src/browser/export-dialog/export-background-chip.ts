import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { DisposableCollection } from '@theia/core/lib/common';
import { inject, injectable } from '@theia/core/shared/inversify';
import { computeExportChipState, ExportChipState } from '../../common/export-chip-state';
import { AkariQuickExportService } from '../../common/quick-export-protocol';
import { AkariExportSessionService } from '../akari-export-session-service';
import { AkariExportDialog } from './akari-export-dialog';
import {
    AkariExportThumbnailStripStore,
    exportThumbnailStripStore
} from './export-thumbnail-strip';
import { formatClock } from './export-view-shared';
import { AkariExportLiveFrameStore, exportLiveFrameStore } from './export-live-frame';

@injectable()
export class AkariExportBackgroundChip implements FrontendApplicationContribution {
    @inject(AkariExportSessionService)
    protected readonly session!: AkariExportSessionService;
    @inject(AkariExportDialog)
    protected readonly dialog!: AkariExportDialog;
    @inject(AkariExportThumbnailStripStore)
    protected readonly thumbnailStripStore!: AkariExportThumbnailStripStore;
    @inject(AkariQuickExportService)
    protected readonly quickExportService!: AkariQuickExportService;

    protected readonly liveFrameStore: AkariExportLiveFrameStore = exportLiveFrameStore();
    protected liveFrameSubscribed = false;

    protected readonly toDispose = new DisposableCollection();
    protected element: HTMLDivElement | undefined;
    protected preview: HTMLDivElement | undefined;
    protected label: HTMLSpanElement | undefined;
    protected progressText: HTMLSpanElement | undefined;
    protected progressTrack: HTMLDivElement | undefined;
    protected progressFill: HTMLElement | undefined;
    protected cancelButton: HTMLButtonElement | undefined;
    protected dismissButton: HTMLButtonElement | undefined;
    protected openButton: HTMLButtonElement | undefined;
    protected dialogVisible = false;
    protected dismissed = false;
    protected thumbnailStoreSubscribed = false;

    onStart(): void {
        if (this.element) {
            return;
        }
        this.dialogVisible = this.dialog.isAttached;
        this.createElement();
        this.ensureThumbnailStoreSubscription();
        if (!this.liveFrameSubscribed) {
            this.liveFrameSubscribed = true;
            this.toDispose.push(this.liveFrameStore.onDidChange(() => this.render()));
        }
        this.toDispose.push(this.session.onDidChange(() => this.render()));
        this.toDispose.push(this.dialog.onDidChangeVisibility(visible => {
            this.dialogVisible = visible;
            this.render();
        }));
        this.render();
    }

    dispose(): void {
        this.toDispose.dispose();
        this.element?.remove();
        this.element = undefined;
    }

    protected createElement(): void {
        const element = document.createElement('div');
        element.hidden = true;
        element.setAttribute('role', 'status');
        element.setAttribute('data-akari-export-chip', 'hidden');
        Object.assign(element.style, {
            position: 'fixed',
            right: '16px',
            bottom: '16px',
            width: '320px',
            zIndex: '4000',
            background: 'var(--akari-card, #141414)',
            border: '1px solid #262626',
            borderRadius: '10px',
            padding: '10px 12px',
            boxShadow: '0 20px 40px -12px rgba(0,0,0,.8)',
            display: 'none',
            gridTemplateColumns: '56px 1fr',
            gap: '10px',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif',
            color: 'var(--akari-ink, #e5e5e5)'
        });

        const preview = document.createElement('div');
        preview.setAttribute('data-akari-export-chip-preview', '');
        Object.assign(preview.style, {
            width: '56px',
            height: '32px',
            borderRadius: '4px',
            background: '#000',
            border: '1px solid #262626'
        });

        const details = document.createElement('div');
        details.style.minWidth = '0';

        const heading = document.createElement('div');
        Object.assign(heading.style, {
            display: 'flex',
            justifyContent: 'space-between',
            gap: '8px',
            alignItems: 'baseline'
        });

        const label = document.createElement('span');
        Object.assign(label.style, {
            minWidth: '0',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: '12px',
            fontWeight: '600',
            color: 'var(--akari-ink, #e5e5e5)'
        });

        const progressText = document.createElement('span');
        Object.assign(progressText.style, {
            flex: '0 0 auto',
            fontFamily: '"SF Mono", Menlo, Consolas, monospace',
            fontSize: '10.5px',
            fontWeight: '500',
            color: '#737373',
            fontVariantNumeric: 'tabular-nums'
        });

        const progressTrack = document.createElement('div');
        Object.assign(progressTrack.style, {
            height: '4px',
            marginTop: '6px',
            background: '#262626',
            borderRadius: '2px',
            overflow: 'hidden'
        });

        const progressFill = document.createElement('b');
        Object.assign(progressFill.style, {
            display: 'block',
            height: '100%',
            width: '0%',
            background: 'var(--akari-accent, #f97316)',
            transition: 'width .2s linear'
        });

        const actions = document.createElement('div');
        Object.assign(actions.style, {
            gridColumn: '1 / 3',
            display: 'flex',
            gap: '6px',
            justifyContent: 'flex-end',
            marginTop: '2px'
        });

        const cancelButton = this.createButton('中止', '書き出しを中止');
        cancelButton.addEventListener('click', () => void this.session.cancel());
        const dismissButton = this.createButton('×', '書き出し通知を閉じる');
        dismissButton.addEventListener('click', () => {
            this.dismissed = true;
            this.render();
        });
        const openButton = this.createButton('開く', '書き出しダイアログを開く', true);
        openButton.addEventListener('click', () => void this.dialog.open(false));

        heading.append(label, progressText);
        progressTrack.appendChild(progressFill);
        details.append(heading, progressTrack);
        actions.append(cancelButton, dismissButton, openButton);
        element.append(preview, details, actions);
        document.body.appendChild(element);

        this.element = element;
        this.preview = preview;
        this.label = label;
        this.progressText = progressText;
        this.progressTrack = progressTrack;
        this.progressFill = progressFill;
        this.cancelButton = cancelButton;
        this.dismissButton = dismissButton;
        this.openButton = openButton;
    }

    protected createButton(text: string, ariaLabel: string, primary = false): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = text;
        button.setAttribute('aria-label', ariaLabel);
        Object.assign(button.style, {
            border: '0',
            background: 'transparent',
            color: primary ? 'var(--akari-accent-light, #fb923c)' : '#a3a3a3',
            fontSize: '11px',
            padding: '3px 6px',
            borderRadius: '5px',
            cursor: 'pointer'
        });
        return button;
    }

    protected render(): void {
        this.liveFrameStore.update(
            this.session.snapshot.status,
            path => this.quickExportService.readPreviewFrame(path)
        );
        let state = computeExportChipState(this.session.snapshot, this.dialogVisible, this.dismissed);
        if (state.kind === 'running' && this.dismissed) {
            this.dismissed = false;
            state = computeExportChipState(this.session.snapshot, this.dialogVisible, false);
        }
        this.applyState(state);
    }

    protected applyState(state: ExportChipState): void {
        const thumbnailStore = this.ensureThumbnailStoreSubscription();
        const element = this.element;
        if (!element || !this.label || !this.progressText || !this.progressTrack || !this.progressFill
            || !this.cancelButton || !this.dismissButton || !this.openButton) {
            return;
        }

        element.setAttribute('data-akari-export-chip', state.kind);
        if (state.kind === 'finished') {
            element.setAttribute('data-akari-export-chip-outcome', state.outcome);
        } else {
            element.removeAttribute('data-akari-export-chip-outcome');
        }

        const hidden = state.kind === 'hidden';
        element.hidden = hidden;
        element.style.display = hidden ? 'none' : 'grid';
        if (hidden) {
            return;
        }

        const running = state.kind === 'running';
        this.label.textContent = running ? state.stageLabel : state.line;
        this.progressText.textContent = running
            ? `${state.percent}%${state.remainingMs === undefined ? '' : ` · 残り約 ${formatClock(state.remainingMs)}`}`
            : '';
        this.progressText.hidden = !running;
        this.progressTrack.hidden = !running;
        if (running) {
            this.progressFill.style.width = `${state.percent}%`;
        }
        if (this.preview) {
            const live = running ? this.liveFrameStore.frame : undefined;
            const frameIndex = running && !live ? thumbnailStore.currentIndex(state.percent) : -1;
            const dataUrl = live?.dataUrl
                ?? (frameIndex >= 0 ? thumbnailStore.strip?.frames[frameIndex]?.dataUrl : undefined);
            this.preview.style.backgroundImage = dataUrl ? `url("${dataUrl}")` : '';
            if (live) this.preview.setAttribute('data-akari-export-chip-live-frame', String(live.frameNumber));
            else this.preview.removeAttribute('data-akari-export-chip-live-frame');
            if (running) {
                this.preview.style.backgroundSize = 'cover';
                this.preview.style.backgroundPosition = 'center';
            }
        }
        this.cancelButton.hidden = !running;
        this.dismissButton.hidden = running;
        this.openButton.hidden = false;
    }

    protected ensureThumbnailStoreSubscription(): AkariExportThumbnailStripStore {
        const store = exportThumbnailStripStore() ?? this.thumbnailStripStore;
        if (!this.thumbnailStoreSubscribed) {
            this.thumbnailStoreSubscribed = true;
            this.toDispose.push(store.onDidChange(() => this.render()));
        }
        return store;
    }
}
