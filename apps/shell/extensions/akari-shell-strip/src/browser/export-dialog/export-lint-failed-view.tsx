import * as React from '@theia/core/shared/react';
import { japaneseLintSummary } from 'akari-annotations/lib/common/lint-message-ja';
import { lintRecheckHint } from '../../common/export-lint-recheck';
import { QuickExportLintFinding } from '../../common/quick-export-protocol';
import { AkariExportSessionService, ExportSessionSnapshot } from '../akari-export-session-service';
import { ExportFrame, VideoFacts } from './export-view-shared';

function findingTitle(finding: QuickExportLintFinding): string {
    const detail = `${finding.check ? `[${finding.check}] ` : ''}${finding.message ?? ''}`;
    const summary = japaneseLintSummary([detail], [finding]);
    if (summary) return summary;
    return finding.severity === 'warning' ? '確認してほしい点があります' : '書き出す前に直す必要があります';
}

export function ExportLintFailedView(props: {
    session: AkariExportSessionService;
    snapshot: ExportSessionSnapshot;
}): React.ReactNode {
    const { session, snapshot } = props;
    const status = snapshot.status;
    const findings = [...(status.lintFindings ?? [])].sort((left, right) =>
        (left.severity === 'error' ? 0 : 1) - (right.severity === 'error' ? 0 : 1));
    const warningOnly = (status.lintErrorCount ?? findings.filter(finding => finding.severity === 'error').length) === 0;
    return (
        <>
            <div className='pb'>
                <div className='left'>
                    <div className='sec'><span>この動画</span><span className='r'>lint で停止</span></div>
                    <ExportFrame video={snapshot.video} />
                    <VideoFacts video={snapshot.video} />
                    <p className='fine'>問題を直したあと、同じ設定からもう一度書き出せます。</p>
                    <p className='fine'>{lintRecheckHint({
                        rechecking: snapshot.lintRechecking,
                        checkedAt: status.lintCheckedAt
                    })}</p>
                </div>
                <div className='rwrap'>
                    <div className='right'>
                        <div className='sec'><span>書き出す前に止めました</span><span className='r'>lint · エラー {status.lintErrorCount ?? 0} · 警告 {status.lintWarningCount ?? 0}</span></div>
                        {findings.length === 0 && <div className='finding'><i /><div><b>lint の問題を確認してください</b>{status.failureSummary ?? '詳しい内容は lint レポートにあります。'}</div></div>}
                        {findings.map((finding, index) => (
                            <div className={`finding${finding.severity === 'warning' ? ' warn' : ''}`} key={`${finding.check ?? 'finding'}-${index}`}>
                                <i /><div><b>{findingTitle(finding)}</b>{finding.message ?? '詳細は lint レポートを確認してください。'} {finding.check && <code>{finding.check}</code>}</div>
                            </div>
                        ))}
                        <div className='acts'>
                            <button type='button' className='btn primary' onClick={() => void session.handOffLintFailure()}>パートナーに直してもらう</button>
                            <button
                                type='button'
                                className='btn'
                                disabled={snapshot.lintRechecking}
                                onClick={() => void session.recheckLint()}
                            >{snapshot.lintRechecking ? '検査中…' : 'もう一度検査する'}</button>
                            <button type='button' className='btn' disabled={!status.reportPath} onClick={() => void session.openArtifact(status.reportPath)}>lint レポートを開く</button>
                            {warningOnly && <button type='button' className='btn ghost' onClick={() => void session.start({ rerunLint: false })}>そのまま書き出す</button>}
                        </div>
                        <p className='fine'>パートナーに直してもらうと、この所見を AI チャットへ渡します。</p>
                    </div>
                </div>
            </div>
            <div className='pf'><span className='fn'>直したら設定に戻ってやり直せます。</span><span className='sp' /><button type='button' className='btn' onClick={() => session.resetToSetup()}>設定に戻る</button></div>
        </>
    );
}
