import { t } from '../../common/shell-text';
import * as React from '@theia/core/shared/react';
import { exportEngineReasonCopyText, exportEngineSummary, japaneseExportReason, lintRefusalSummary, summarizeExportReasons } from '../../common/export-engine-reason';
import { QuickExportStatus } from '../../common/quick-export-protocol';

export function ExportEngineReasonView(props: {
    status: QuickExportStatus;
    openLint?: () => void;
    onCopy?: (text: string) => Promise<boolean>;
}): React.ReactNode {
    const { status } = props;
    const [copied, setCopied] = React.useState(false);
    const copyResetTimer = React.useRef<number | undefined>(undefined);
    React.useEffect(() => () => {
        if (copyResetTimer.current !== undefined) window.clearTimeout(copyResetTimer.current);
    }, []);
    const copyReasons = async (): Promise<void> => {
        if (!status.exportEngine || !props.onCopy || !await props.onCopy(exportEngineReasonCopyText(status.exportEngine))) return;
        setCopied(true);
        if (copyResetTimer.current !== undefined) window.clearTimeout(copyResetTimer.current);
        copyResetTimer.current = window.setTimeout(() => {
            setCopied(false);
            copyResetTimer.current = undefined;
        }, 2000);
    };
    if (status.phase === 'lint-failed' || status.exportRefusal?.code === 'lint-not-pass') {
        const message = lintRefusalSummary(status.lintFindings ?? [])
            ?? status.exportRefusal?.message ?? t('shell.exportDialog.engineReason.reviewLintIssuesText');
        return <div className='akari-export-engine-reason akari-export-refused'>
            <div>{t('shell.exportDialog.engineReason.couldNotExportError')}{message}</div>
            <div className='akari-export-fix'>{t('shell.exportDialog.engineReason.fixTheseExportingAction')}<button type='button' className='btn' disabled={!props.openLint} onClick={props.openLint}>{t('shell.exportDialog.engineReason.openLintAction')}</button></div>
        </div>;
    }
    if (status.phase === 'failed') {
        const message = status.exportRefusal?.message ?? status.failureSummary ?? t('shell.exportDialog.engineReason.checkExportLogAction');
        return <div className='akari-export-engine-reason akari-export-refused'>
            {t('shell.exportDialog.engineReason.exportFailedInlinePrefix').trimStart()}{message}{t('shell.exportDialog.engineReason.checkSettingsInputsExportAgainMessage').trimEnd()}</div>;
    }
    const event = status.exportEngine;
    if (!event) return null;
    const reasons = summarizeExportReasons(event.reasons);
    return <div className='akari-export-engine-reason'>
        {reasons.length > 0
            ? <details><summary>{exportEngineSummary(event)}</summary>
                {props.onCopy && <button type='button' className='btn akari-export-engine-reason-copy' onClick={() => void copyReasons()}>
                    {copied ? t('shell.exportDialog.engineReason.copiedStatus') : t('shell.exportDialog.engineReason.copyAction')}
                </button>}
                <ul className='akari-export-engine-reason-list'>
                    {event.reasons.map((reason, index) => <li key={`${reason.id}-${index}`}>
                        {reason.kind === 'caption' ? t('shell.exportDialog.engineReason.captionsLabel') : reason.kind === 'overlay' ? t('shell.exportDialog.engineReason.overlaysLabel') : reason.kind} {reason.id}: {japaneseExportReason(reason.reason)}（{reason.reason}）
                    </li>)}
                </ul>
            </details>
            : <span>{exportEngineSummary(event)}</span>}
    </div>;
}
