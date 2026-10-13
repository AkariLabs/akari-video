import { t } from '../../common/shell-text';
import * as React from '@theia/core/shared/react';
import { japaneseLintSummary } from 'akari-annotations/lib/common/lint-message-ja';
import { lintRecheckHint } from '../../common/export-lint-recheck';
import { QuickExportLintFinding } from '../../common/quick-export-protocol';
import { AkariExportSessionService, ExportSessionSnapshot } from '../akari-export-session-service';
import { ExportFrame, VideoFacts } from './export-view-shared';
import { ExportEngineReasonView } from './export-engine-reason-view';

function findingTitle(finding: QuickExportLintFinding): string {
    const detail = `${finding.check ? `[${finding.check}] ` : ''}${finding.message ?? ''}`;
    const summary = japaneseLintSummary([detail], [finding]);
    if (summary) return summary;
    return finding.severity === 'warning' ? t('shell.exportDialog.lintFailure.someItemsNeedReviewText') : t('shell.exportDialog.lintFailure.fixTheseExportingAction');
}

export function ExportLintFailedView(props: {
    session: AkariExportSessionService;
    snapshot: ExportSessionSnapshot;
    close: () => void;
}): React.ReactNode {
    const { session, snapshot } = props;
    const status = snapshot.status;
    // ExportDoneView と同じ理由: このダイアログはモーダルなので、開いたレポートのタブは
    // ダイアログを閉じるまで見えない。開く操作は閉じるところまでで 1 つ。
    const openAndClose = (path: string | undefined): void => {
        props.close();
        void session.openArtifact(path);
    };
    const findings = [...(status.lintFindings ?? [])].sort((left, right) =>
        (left.severity === 'error' ? 0 : 1) - (right.severity === 'error' ? 0 : 1));
    const warningOnly = (status.lintErrorCount ?? findings.filter(finding => finding.severity === 'error').length) === 0;
    return (
        <>
            <div className='pb'>
                <div className='left'>
                    <div className='sec'><span>{t('shell.exportDialog.lintFailure.videoLabel')}</span><span className='r'>{t('shell.exportDialog.lintFailure.stoppedLintStatus')}</span></div>
                    <ExportFrame video={snapshot.video} />
                    <VideoFacts video={snapshot.video} />
                    <p className='fine'>{t('shell.exportDialog.lintFailure.fixingIssuesExportAgainSettingsMessage')}</p>
                    <p className='fine'>{lintRecheckHint({
                        rechecking: snapshot.lintRechecking,
                        checkedAt: status.lintCheckedAt
                    })}</p>
                </div>
                <div className='rwrap'>
                    <div className='right'>
                        <div className='sec'><span>{t('shell.exportDialog.lintFailure.stoppedExportStatus')}</span><span className='r'>{t('shell.exportDialog.lintFailure.lintErrorsLabel')}{status.lintErrorCount ?? 0} {t('shell.exportDialog.lintFailure.warningsLabel')}{status.lintWarningCount ?? 0}</span></div>
                        {findings.length === 0 && <div className='finding'><i /><div><b>{t('shell.exportDialog.lintFailure.reviewLintIssuesText')}</b>{status.failureSummary ?? t('shell.exportDialog.lintFailure.seeLintReportDetailsMessage')}</div></div>}
                        {findings.map((finding, index) => (
                            <div className={`finding${finding.severity === 'warning' ? ' warn' : ''}`} key={`${finding.check ?? 'finding'}-${index}`}>
                                <i /><div><b>{findingTitle(finding)}</b>{finding.message ?? t('shell.exportDialog.lintFailure.checkLintReportDetailsMessage')} {finding.check && <code>{finding.check}</code>}</div>
                            </div>
                        ))}
                        <div className='acts'>
                            <button type='button' className='btn primary' onClick={() => void session.handOffLintFailure()}>{t('shell.exportDialog.lintFailure.askPartnerFixAction')}</button>
                            <button
                                type='button'
                                className='btn'
                                disabled={snapshot.lintRechecking}
                                onClick={() => void session.recheckLint()}
                            >{snapshot.lintRechecking ? t('shell.exportDialog.lintFailure.checkingStatus') : t('shell.exportDialog.lintFailure.checkAgainAction')}</button>
                            {warningOnly && <button type='button' className='btn ghost' onClick={() => void session.start({ rerunLint: false })}>{t('shell.exportDialog.lintFailure.exportAnywayAction')}</button>}
                        </div>
                        <p className='fine'>{t('shell.exportDialog.lintFailure.askPartnerFixTheseFindingsSentAiChatMessage')}</p>
                    </div>
                </div>
            </div>
            <ExportEngineReasonView status={status} openLint={status.reportPath ? () => openAndClose(status.reportPath) : undefined} />
            <div className='pf'><span className='fn'>{t('shell.exportDialog.lintFailure.fixingIssuesReturnSettingsTryAgainMessage')}</span><span className='sp' /><button type='button' className='btn' onClick={() => session.resetToSetup()}>{t('shell.exportDialog.lintFailure.backSettingsLabel')}</button></div>
        </>
    );
}
