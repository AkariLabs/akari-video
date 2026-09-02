import * as React from '@theia/core/shared/react';
import { QuickExportStage } from '../../common/quick-export-progress';
import { quickExportStageLabel } from '../../common/quick-export-ui';
import { AkariExportSessionService, ExportSessionSnapshot } from '../akari-export-session-service';
import { ExportFrame, formatClock, VideoFacts } from './export-view-shared';

const STAGES: readonly QuickExportStage[] = ['prepare', 'audio-cut', 'render', 'audio-mix', 'verify'];

function stepDetail(stage: QuickExportStage, snapshot: ExportSessionSnapshot): string {
    const status = snapshot.status;
    if (stage === 'render') {
        const frames = status.progressFrame !== undefined && status.progressTotalFrames !== undefined
            ? `${status.progressFrame} / ${status.progressTotalFrames} コマ`
            : 'コマ数を計算中…';
        return `${frames} · ${snapshot.video.fps ?? '—'} fps · ${(status.progressEngine ?? snapshot.settings.engine).toUpperCase()}`;
    }
    if (stage === 'audio-cut' && status.progressPercent !== undefined) {
        return `${status.progressPercent}%`;
    }
    return '…';
}

export function ExportRunningView(props: {
    session: AkariExportSessionService;
    snapshot: ExportSessionSnapshot;
    close: () => void;
}): React.ReactNode {
    const { session, snapshot } = props;
    const status = snapshot.status;
    const activeIndex = status.phase === 'linting'
        ? 0
        : Math.max(0, STAGES.indexOf(status.progressStage ?? 'prepare'));
    const percent = Math.max(0, Math.min(100, status.progressPercent ?? 0));
    const frameFraction = status.progressFrame !== undefined && status.progressTotalFrames
        ? Math.max(0, Math.min(100, status.progressFrame / status.progressTotalFrames * 100))
        : 0;
    return (
        <>
            <div className='pb'>
                <div className='left'>
                    <div className='sec'><span>今描いている絵</span><span className='r'>書き出し中の画角</span></div>
                    <ExportFrame video={snapshot.video} previewSlot />
                    <VideoFacts video={snapshot.video} />
                    <p className='fine'>帯と実フレームは後続の機能でこの枠に表示されます。</p>
                </div>
                <div className='rwrap'>
                    <div className='right'>
                        {status.phase === 'linting' && <p className='fine' style={{ margin: '0 0 8px' }}>lint 確認中…</p>}
                        <div className='sec'><span>いま何をしているか</span><span className='r'>{status.progressEngine ? `${status.progressEngine.toUpperCase()} · ` : ''}{percent}%</span></div>
                        <div className='steps'>
                            {STAGES.map((stage, index) => {
                                const state = index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'pending';
                                return (
                                    <div className={`step ${state}`} key={stage}>
                                        <span className='ic' />
                                        <span>{quickExportStageLabel(stage)}{state === 'active' && <span className='sub'>{stepDetail(stage, snapshot)}</span>}</span>
                                        <span className='dt'>{state === 'active' ? stepDetail(stage, snapshot) : ''}</span>
                                        {stage === 'render' && <div className='subbar'><b style={{ width: `${frameFraction}%` }} /></div>}
                                    </div>
                                );
                            })}
                        </div>
                        <div className='overall'>
                            <div className='lbl'><b>{percent}%</b><span>経過 {formatClock(status.progressElapsedMs)} · {status.progressRemainingMs !== undefined ? `残り約 ${formatClock(status.progressRemainingMs)}` : '残り時間を計算中…'}</span></div>
                            <div className='bar'><b style={{ width: `${percent}%` }} /></div>
                        </div>
                    </div>
                </div>
            </div>
            <div className='pf'>
                <span className='fn'>閉じても書き出しは続きます。</span><span className='sp' />
                <button type='button' className='btn' onClick={props.close}>閉じて作業を続ける</button>
                <button type='button' className='btn danger' onClick={() => void session.cancel()}>中止</button>
            </div>
        </>
    );
}
