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
            ?? status.exportRefusal?.message ?? 'Lint の問題を確認してください';
        return <div className='akari-export-engine-reason akari-export-refused'>
            <div>書き出せませんでした: {message}</div>
            <div className='akari-export-fix'>書き出す前に直すものがあります — <button type='button' className='btn' disabled={!props.openLint} onClick={props.openLint}>Lint を開く</button></div>
        </div>;
    }
    if (status.phase === 'failed') {
        const message = status.exportRefusal?.message ?? status.failureSummary ?? '書き出しのログを確認してください';
        return <div className='akari-export-engine-reason akari-export-refused'>
            書き出せませんでした: {message}。設定と入力を確認して、もう一度書き出してください。
        </div>;
    }
    const event = status.exportEngine;
    if (!event) return null;
    const reasons = summarizeExportReasons(event.reasons);
    return <div className='akari-export-engine-reason'>
        {reasons.length > 0
            ? <details><summary>{exportEngineSummary(event)}</summary>
                {props.onCopy && <button type='button' className='btn akari-export-engine-reason-copy' onClick={() => void copyReasons()}>
                    {copied ? 'コピーしました' : 'コピー'}
                </button>}
                <ul className='akari-export-engine-reason-list'>
                    {event.reasons.map((reason, index) => <li key={`${reason.id}-${index}`}>
                        {reason.kind === 'caption' ? '字幕' : reason.kind === 'overlay' ? 'オーバーレイ' : reason.kind} {reason.id}: {japaneseExportReason(reason.reason)}（{reason.reason}）
                    </li>)}
                </ul>
            </details>
            : <span>{exportEngineSummary(event)}</span>}
    </div>;
}
