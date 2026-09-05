import * as React from '@theia/core/shared/react';
import { EXPORT_SHARE_TARGETS } from '../../common/export-share';
import { resolveOutputResolution } from '../../common/export-settings';
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
    // 書き出しダイアログは ReactDialog（aria-modal のオーバーレイ）なので、開いたタブは
    // そのままではダイアログの下に隠れて「押しても何も起きない」に見える。開く操作は
    // ダイアログを閉じるところまでを 1 つの動作として扱う（Finder で表示・コピー・SNS は
    // アプリ外の動作なのでダイアログを開いたまま続けられる = 閉じない）。
    const openAndClose = (path: string | undefined): void => {
        props.close();
        void session.openArtifact(path);
    };
    const outputResolution = resolveOutputResolution(snapshot.video, snapshot.settings);
    const format: Readonly<Record<ExportSessionSnapshot['settings']['codec'], { video: string; audio: string; color: string }>> = {
        h264: { video: 'H.264', audio: 'AAC', color: 'Rec.709' },
        hevc: { video: 'H.265', audio: 'AAC', color: 'Rec.709' },
        prores422: { video: 'ProRes 422 HQ', audio: 'PCM', color: '10-bit · Rec.709' },
        png: { video: 'PNG 連番', audio: 'WAV', color: 'Rec.709' }
    };
    const labels = format[snapshot.settings.codec];
    const directoryArtifact = snapshot.settings.codec === 'png';
    const [copied, setCopied] = React.useState(false);
    const copyResetTimer = React.useRef<number | undefined>(undefined);
    React.useEffect(() => () => {
        if (copyResetTimer.current !== undefined) {
            window.clearTimeout(copyResetTimer.current);
        }
    }, []);
    const copyArtifact = async (): Promise<void> => {
        if (!await session.copyArtifact()) {
            return;
        }
        setCopied(true);
        if (copyResetTimer.current !== undefined) {
            window.clearTimeout(copyResetTimer.current);
        }
        copyResetTimer.current = window.setTimeout(() => {
            setCopied(false);
            copyResetTimer.current = undefined;
        }, 2000);
    };
    return (
        <>
            <div className='pb'>
                <div className='left'>
                    <div className='sec'><span>できた動画</span><span className='r'>確認済み</span></div>
                    <ExportFrame video={snapshot.video} />
                    <VideoFacts video={snapshot.video} />
                    <p className='fine'>{directoryArtifact ? 'フォルダを開く' : '動画を開く'}か、Finder で保存先を確認できます。</p>
                </div>
                <div className='rwrap'>
                    <div className='right'>
                        <div className='sec'><span>できました</span><span className='r'>{engineLabel(snapshot)} · {formatClock(status.progressElapsedMs)}</span></div>
                        <div className='result'>
                            <div className='fnm'>{status.artifactPath ?? snapshot.outputName}<span className='pill good'>✓ 確認済み</span></div>
                            <div className='facts'>
                                <div><small>容量</small><b>{formatBytes(status.artifactSize)}</b></div>
                                <div><small>長さ</small><b>{formatDuration(snapshot.video.durationSeconds, true)}</b></div>
                                <div><small>画角</small><b>{ratioLabel(snapshot.video)} · {outputResolution.width}×{outputResolution.height}</b></div>
                                <div><small>fps</small><b>{snapshot.settings.fps ?? snapshot.video.fps ?? '—'}</b></div>
                                <div><small>映像 / 音声</small><b>{labels.video} / {labels.audio}</b></div>
                                <div><small>エンジン</small><b>{engineLabel(snapshot)}</b></div>
                            </div>
                            <div className='checks'><span>成果物の存在と容量を確認</span><span>編集の画角・fps と一致</span><span>{labels.video} / {labels.audio} · {labels.color}</span></div>
                        </div>
                        <div className='acts'>
                            <button type='button' className='btn primary' disabled={!status.artifactPath} onClick={() => openAndClose(status.artifactPath)}>{directoryArtifact ? 'フォルダを開く' : '動画を開く'}</button>
                            <button type='button' className='btn' disabled={!status.artifactPath} onClick={() => void session.revealArtifact()}>Finder で表示</button>
                            {status.reportPath && <button type='button' className='btn ghost' onClick={() => openAndClose(status.reportPath)}>レポートを開く</button>}
                        </div>
                        <div className='acts' style={{ alignItems: 'center' }}>
                            <button type='button' className='btn' disabled={!status.artifactPath} onClick={() => void copyArtifact()}>{copied ? 'コピーしました' : 'コピー'}</button>
                            <span style={{ fontSize: '11px', fontWeight: 600 }}>SNS に投稿</span>
                            {EXPORT_SHARE_TARGETS.map(target => (
                                <button
                                    key={target.id}
                                    type='button'
                                    className='btn'
                                    title={`${target.label} の投稿 / アップロード画面を外部ブラウザで開く`}
                                    onClick={() => session.openShareTarget(target.id)}
                                >{target.label}</button>
                            ))}
                            <span className='fine' style={{ margin: 0 }}>先にコピーしてから貼り付けできます</span>
                        </div>
                        <div className='acts' style={{ alignItems: 'center', marginTop: '12px' }}>
                            <button type='button' className='btn ghost' disabled={!status.artifactPath} onClick={() => void session.handOffFinished()}>パートナーに渡す</button>
                            <span className='fine' style={{ margin: 0 }}>AI チャットに入ります</span>
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
