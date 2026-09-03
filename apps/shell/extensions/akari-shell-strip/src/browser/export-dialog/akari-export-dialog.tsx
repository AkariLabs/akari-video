import * as React from '@theia/core/shared/react';
import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog';
import { Emitter, Event } from '@theia/core/lib/common';
import { Message } from '@theia/core/shared/@lumino/messaging';
import { AkariExportSessionService } from '../akari-export-session-service';
import { ensureExportDialogStyle } from './export-dialog-style';
import { ExportSetupView } from './export-setup-view';
import { ExportRunningView } from './export-running-view';
import { ExportDoneView } from './export-done-view';
import { ExportLintFailedView } from './export-lint-failed-view';

export class AkariExportDialog extends ReactDialog<void> {
    protected readonly visibilityEmitter = new Emitter<boolean>();
    readonly onDidChangeVisibility: Event<boolean> = this.visibilityEmitter.event;

    constructor(protected readonly session: AkariExportSessionService) {
        super({ title: '書き出し', maxWidth: 880 });
        this.addClass('akari-export-dialog-host');
        ensureExportDialogStyle();
        this.toDispose.push(this.session.onDidChange(() => this.update()));
        this.toDispose.push(this.visibilityEmitter);
    }

    get value(): void {
        return undefined;
    }

    protected override onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        // 開いた瞬間に lint を検査し直させる（保持された古い所見を出さないため）。
        this.session.setDialogVisible(true);
        this.visibilityEmitter.fire(true);
    }

    protected override onAfterDetach(msg: Message): void {
        super.onAfterDetach(msg);
        this.session.setDialogVisible(false);
        this.visibilityEmitter.fire(false);
    }

    protected render(): React.ReactNode {
        const snapshot = this.session.snapshot;
        const status = snapshot.status;
        const running = status.phase === 'linting' || status.phase === 'rendering';
        const view = running
            ? 'running'
            : status.phase === 'done' && !snapshot.setupRequested
                ? 'done'
                : status.phase === 'lint-failed' && !snapshot.setupRequested
                    ? 'lint-failed'
                    : 'setup';
        const subtitle = view === 'running'
            ? `${snapshot.outputName} · 閉じても続きます`
            : view === 'done'
                ? status.artifactPath ?? snapshot.outputName
                : view === 'lint-failed'
                    ? `lint で ${status.lintIssueCount ?? 0} 件`
                    : `${snapshot.projectLabel || 'このプロジェクト'} · edit.json の出力設定`;
        return (
            <div className='popup' role='dialog' aria-modal='true' aria-labelledby='akari-export-dialog-title'>
                <div className='ph'>
                    <div><div className='ttl' id='akari-export-dialog-title'>{view === 'done' ? '書き出し完了' : '書き出し'}</div><div className='sub'>{subtitle}</div></div>
                    {running && <span className='pill'><span className='dot blink' />書き出し中 · {status.progressPercent ?? 0}%</span>}
                    <button type='button' className='x' aria-label='閉じる' onClick={() => this.close()}>×</button>
                </div>
                {view === 'running' && <ExportRunningView session={this.session} snapshot={snapshot} close={() => this.close()} />}
                {view === 'done' && <ExportDoneView session={this.session} snapshot={snapshot} close={() => this.close()} />}
                {view === 'lint-failed' && <ExportLintFailedView session={this.session} snapshot={snapshot} />}
                {view === 'setup' && <ExportSetupView session={this.session} snapshot={snapshot} />}
            </div>
        );
    }
}
