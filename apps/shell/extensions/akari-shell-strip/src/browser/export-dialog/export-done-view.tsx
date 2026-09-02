import * as React from '@theia/core/shared/react';
import { AkariExportSessionService, ExportSessionSnapshot } from '../akari-export-session-service';
import { ExportFrame, formatBytes, formatClock, formatDuration, ratioLabel, VideoFacts } from './export-view-shared';

function engineLabel(snapshot: ExportSessionSnapshot): string {
    const renderEngine = snapshot.renderProgress?.engine;
    const engine = snapshot.status.progressEngine ?? renderEngine?.name;
    if (engine === 'gpu') return 'GPU';
    if (engine === 'osr') {
        const reason = renderEngine?.fallbackReason ?? renderEngine?.ineligible?.[0];
        return reason ? `OSR（${reason}）` : 'OSR';
    }
    return engine?.toUpperCase() ?? '—';
}

export function ExportDoneView(props: {
    session: AkariExportSessionService;
    snapshot: ExportSessionSnapshot;
    close: () => void;
}): React.ReactNode {
    const { session, snapshot } = props;
    const status = snapshot.status;
    return (
        <>
            <div className='pb'>
                <div className='left'>
                    <div className='sec'><span>できた動画</span><span className='r'>確認済み</span></div>
                    <ExportFrame video={snapshot.video} />
                    <VideoFacts video={snapshot.video} />
                    <p className='fine'>動画を開くか、Finder で保存先を確認できます。</p>
                </div>
                <div className='rwrap'>
                    <div className='right'>
                        <div className='sec'><span>できました</span><span className='r'>{engineLabel(snapshot)} · {formatClock(status.progressElapsedMs)}</span></div>
                        <div className='result'>
                            <div className='fnm'>{status.artifactPath ?? snapshot.outputName}<span className='pill good'>✓ 確認済み</span></div>
                            <div className='facts'>
                                <div><small>容量</small><b>{formatBytes(status.artifactSize)}</b></div>
                                <div><small>長さ</small><b>{formatDuration(snapshot.video.durationSeconds, true)}</b></div>
                                <div><small>画角</small><b>{ratioLabel(snapshot.video)} · {snapshot.video.width ?? '—'}×{snapshot.video.height ?? '—'}</b></div>
                                <div><small>fps</small><b>{snapshot.settings.fps ?? snapshot.video.fps ?? '—'}</b></div>
                                <div><small>映像 / 音声</small><b>H.264 / AAC</b></div>
                                <div><small>エンジン</small><b>{engineLabel(snapshot)}</b></div>
                            </div>
                            <div className='checks'><span>成果物の存在と容量を確認</span><span>編集の画角・fps と一致</span><span>H.264 / AAC · Rec.709</span></div>
                        </div>
                        <div className='acts'>
                            <button type='button' className='btn primary' disabled={!status.artifactPath} onClick={() => void session.openArtifact(status.artifactPath)}>動画を開く</button>
                            <button type='button' className='btn' disabled={!status.artifactPath} onClick={() => void session.revealArtifact()}>Finder で表示</button>
                            {status.reportPath && <button type='button' className='btn ghost' onClick={() => void session.openArtifact(status.reportPath)}>レポートを開く</button>}
                        </div>
                    </div>
                </div>
            </div>
            <div className='pf'>
                <button type='button' className='btn ghost' onClick={() => session.resetToSetup()}>もう一度書き出す</button>
                <span className='sp' /><button type='button' className='btn' onClick={props.close}>閉じる</button>
            </div>
        </>
    );
}
