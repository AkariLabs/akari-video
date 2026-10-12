import { t } from '../../common/shell-text';
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
import { ExportEngineReasonView } from './export-engine-reason-view';

export class AkariExportDialog extends ReactDialog<void> {
    protected readonly visibilityEmitter = new Emitter<boolean>();
    readonly onDidChangeVisibility: Event<boolean> = this.visibilityEmitter.event;

    constructor(protected readonly session: AkariExportSessionService) {
        super({ title: t('shell.exportDialog.window.exportAction'), maxWidth: 880 });
        this.addClass('akari-export-dialog-host');
        this.node.setAttribute('data-akari-onboarding-target', 'export-dialog');
        ensureExportDialogStyle();
        this.toDispose.push(this.session.onDidChange(() => this.update()));
        this.toDispose.push(this.visibilityEmitter);
        this.node.addEventListener('keydown', this.onEscapeKeyDown, true);
        this.toDispose.push({ dispose: () => this.node.removeEventListener('keydown', this.onEscapeKeyDown, true) });
    }

    protected readonly onEscapeKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        this.handleEscape(event);
    };

    get value(): void {
        return undefined;
    }

    protected override handleEscape(_event: KeyboardEvent): boolean | void {
        const phase = this.session.snapshot.status.phase;
        if (phase === 'linting' || phase === 'rendering') return false;
        this.close();
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
                    : status.phase === 'failed' && !snapshot.setupRequested
                        ? 'failed'
                    : 'setup';
        const subtitle = view === 'running'
            ? t('shell.exportDialog.window.continuesClosingStatus', { value1: snapshot.outputName })
            : view === 'done'
                ? status.artifactPath ?? snapshot.outputName
                : view === 'lint-failed'
                    ? t('shell.exportDialog.window.lintIssuesLabel', { value1: status.lintIssueCount ?? 0, n: status.lintIssueCount ?? 0 })
                    : view === 'failed'
                        ? t('shell.exportDialog.window.exportStoppedStatus')
                    : t('shell.exportDialog.window.editJsonOutputSettingsText', { value1: snapshot.projectLabel || t('shell.exportDialog.window.projectLabel') });
        return (
            <div className='popup' role='dialog' aria-modal='true' aria-labelledby='akari-export-dialog-title'>
                <div className='ph'>
                    <div><div className='ttl' id='akari-export-dialog-title'>{view === 'done' ? t('shell.exportDialog.window.exportCompleteStatus') : t('shell.exportDialog.window.exportAction')}</div><div className='sub'>{subtitle}</div></div>
                    {running && <span className='pill'><span className='dot blink' />{t('shell.exportDialog.window.exportingStatus')}{status.progressPercent ?? 0}%</span>}
                    <button type='button' className='x' data-akari-onboarding-target='export-close' aria-label={t('shell.exportDialog.window.closeAction')} onClick={() => this.close()}>×</button>
                </div>
                {view === 'running' && <ExportRunningView session={this.session} snapshot={snapshot} close={() => this.close()} />}
                {view === 'done' && <ExportDoneView session={this.session} snapshot={snapshot} close={() => this.close()} />}
                {view === 'lint-failed' && <ExportLintFailedView session={this.session} snapshot={snapshot} close={() => this.close()} />}
                {view === 'failed' && <>
                    <div className='pb'><div className='right'><h2>{t('shell.exportDialog.window.exportStoppedStatus')}</h2><p>{t('shell.exportDialog.window.checkSettingsInputsTryAgainMessage')}</p></div></div>
                    <ExportEngineReasonView status={status} openLint={status.reportPath ? () => { this.close(); void this.session.openArtifact(status.reportPath); } : undefined} />
                    <div className='pf'><span className='sp' /><button type='button' className='btn' data-akari-onboarding-target='export-back-settings' onClick={() => this.session.resetToSetup()}>{t('shell.exportDialog.window.backSettingsLabel')}</button></div>
                </>}
                {view === 'setup' && <ExportSetupView session={this.session} snapshot={snapshot} />}
            </div>
        );
    }
}
