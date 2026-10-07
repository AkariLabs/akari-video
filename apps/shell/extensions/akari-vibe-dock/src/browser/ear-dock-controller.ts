import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { Disposable, DisposableCollection } from '@theia/core/lib/common';
import { inject, injectable } from '@theia/core/shared/inversify';
import { EarStatus } from '../common/ear-protocol';
import { VibeDockState } from '../common/vibe-dock-state';
import { isVibePreviewEnabled } from '../common/vibe-preview';
import { EarSession } from './ear-session';
import { NowVibeDockTab } from './vibe-dock-tabs';

@injectable()
export class EarDockController implements FrontendApplicationContribution {
    @inject(EarSession) protected readonly ear!: EarSession;
    @inject(VibeDockState) protected readonly dock!: VibeDockState;
    @inject(NowVibeDockTab) protected readonly now!: NowVibeDockTab;
    protected readonly subscriptions = new DisposableCollection();
    protected statusLine: Disposable | undefined;
    protected paperOpen = false;
    protected playbackT = 0;
    protected enabled = false;
    protected errorReason: string | undefined;

    onStart(): void {
        this.enabled = isVibePreviewEnabled(window.localStorage);
        if (!this.enabled) return;
        this.subscriptions.push(this.dock.onDidPressMark(() => { void this.toggle(); }));
        this.subscriptions.push(this.ear.onDidChange(status => this.paintStatus(status)));
        this.subscriptions.push(this.ear.onUtterance(value => {
            if (this.ear.state.purpose !== 'note' || value.kind === 'command') return;
            if (!value.final && this.ear.state.state !== 'listening') return;
            if (!this.paperOpen) this.now.acceptUtterance(value, this.playbackT);
        }));
        window.addEventListener('akari.sketch.opened', this.opened);
        window.addEventListener('akari.sketch.closed', this.closed);
        window.addEventListener('akari.sketch.earClosed', this.earClosed);
        window.addEventListener('akari.preview.playbackTick', this.playbackTick);
    }

    protected readonly opened = (): void => {
        this.ear.flushPending();
        this.paperOpen = true;
        this.ear.setPaperOpen(true);
        this.now.clearPartial();
        if (this.ear.state.state === 'listening') this.setLine('紙のメモに残しています');
    };
    protected readonly closed = (): void => {
        // 録音型は閉じたあと文字になる。耳からの確定文を紙に渡し終えるまで保持する。
        if (this.ear.state.state !== 'listening') this.earClosed();
    };
    protected readonly earClosed = (): void => {
        this.paperOpen = false;
        this.ear.setPaperOpen(false);
        this.paintStatus(this.ear.state);
    };
    protected readonly playbackTick = (event: Event): void => {
        const time = (event as CustomEvent<{ time?: number }>).detail?.time;
        if (typeof time === 'number' && Number.isFinite(time) && time >= 0) this.playbackT = time;
    };

    protected setLine(line?: string, tone: 'info' | 'error' = 'info'): void {
        this.statusLine?.dispose();
        this.statusLine = line ? this.dock.status.set(line, tone, 'ear') : undefined;
    }

    protected paintStatus(status: EarStatus): void {
        if (status.state === 'idle' || status.state === 'stopping' || status.state === 'error') this.now.clearPartial();
        if (status.state === 'error') {
            this.errorReason = status.message ?? '聞き取りを続けられませんでした';
        }
        if (this.errorReason) {
            this.dock.setMark('idle', this.errorReason);
            this.setLine(this.errorReason, 'error');
            return;
        }
        if (status.purpose === 'trial' && status.state !== 'idle') {
            this.dock.setMark('idle', '試し聞きが動いています');
            this.setLine('試し聞きが動いています');
            return;
        }
        this.dock.setMark(status.state === 'listening' ? 'listening' : 'idle');
        if (status.state === 'starting') this.setLine('聞き取りを始めています…');
        else if (status.state === 'listening') this.setLine(this.paperOpen ? '紙のメモに残しています'
            : status.engine === 'record-then-transcribe' ? '録音しています。止めたあとで文字にします' : '聞いています');
        else if (status.state === 'stopping') this.setLine(status.engine === 'record-then-transcribe' ? '文字にしています…' : '停止しています…');
        else this.setLine();
    }

    async toggle(): Promise<void> {
        if (!this.enabled) return;
        const state = this.ear.state.state;
        if (state === 'starting' || state === 'stopping') return;
        if (state === 'listening' && this.ear.state.purpose === 'trial') {
            this.dock.setMark('idle', '試し聞きが動いています');
            this.setLine('試し聞きが動いています', 'error');
            return;
        }
        if (state === 'listening') await this.ear.stop();
        else {
            this.errorReason = undefined;
            this.dock.setMark('idle');
            this.setLine();
            await this.ear.start({ purpose: 'note' });
        }
    }

    onDockDisposed(): void { if (this.enabled && this.ear.state.purpose === 'note') void this.ear.stop(); }

    onStop(): void {
        if (!this.enabled) return;
        window.removeEventListener('akari.sketch.opened', this.opened);
        window.removeEventListener('akari.sketch.closed', this.closed);
        window.removeEventListener('akari.sketch.earClosed', this.earClosed);
        window.removeEventListener('akari.preview.playbackTick', this.playbackTick);
        this.subscriptions.dispose();
        this.setLine();
        void this.ear.stop();
    }
}
