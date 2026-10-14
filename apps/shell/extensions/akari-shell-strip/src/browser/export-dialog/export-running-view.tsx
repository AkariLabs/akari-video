import { t } from '../../common/shell-text';
import * as React from '@theia/core/shared/react';
import { QuickExportStage } from '../../common/quick-export-progress';
import { quickExportStageLabel } from '../../common/quick-export-ui';
import { AkariExportSessionService, ExportSessionSnapshot } from '../akari-export-session-service';
import { ExportThumbnailStrip } from './export-thumbnail-strip';
import { ExportFrame, formatClock, VideoFacts } from './export-view-shared';
import { ExportLiveFramePainter, useExportLiveFrame } from './export-live-frame';
import { ExportEngineReasonView } from './export-engine-reason-view';

const STAGES: readonly QuickExportStage[] = ['prepare', 'audio-cut', 'render', 'audio-mix', 'verify'];

function stepDetail(stage: QuickExportStage, snapshot: ExportSessionSnapshot): string {
    const status = snapshot.status;
    if (stage === 'render') {
        const frames = status.progressFrame !== undefined && status.progressTotalFrames !== undefined
            ? t('shell.exportDialog.progress.frameLabel', { value1: status.progressFrame, value2: status.progressTotalFrames })
            : t('shell.exportDialog.progress.calculatingFrameCountText');
        return `${frames} · ${snapshot.video.fps ?? '—'} fps`;
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
    const liveFrame = useExportLiveFrame();
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
                    <div className='sec'><span>{t('shell.exportDialog.progress.currentFrameLabel')}</span><span className='r'>{t('shell.exportDialog.progress.exportOrientationAction')}</span></div>
                    <ExportFrame video={snapshot.video} previewSlot />
                    <ExportLiveFramePainter />
                    <ExportThumbnailStrip percent={percent} />
                    <VideoFacts video={snapshot.video} />
                    <p className='fine'>{liveFrame
                        ? t('shell.exportDialog.progress.compositedFrameFramePerSecondMessage')
                        : t('shell.exportDialog.progress.assetStripTextOverlaysEffectsNotIncludedMessage')}</p>
                </div>
                <div className='rwrap'>
                    <div className='right'>
                        {status.phase === 'linting' && <p className='fine' style={{ margin: '0 0 8px' }}>{t('shell.exportDialog.progress.checkingLintLabel')}</p>}
                        <div className='sec'><span>{t('shell.exportDialog.progress.currentTaskLabel')}</span><span className='r'>{percent}%</span></div>
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
                        <div className='overall' data-akari-onboarding-target='export-progress'>
                            <div className='lbl'><b>{percent}%</b><span>{t('shell.exportDialog.progress.elapsedStatus')}{formatClock(status.progressElapsedMs)} · {status.progressRemainingMs !== undefined ? t('shell.exportDialog.progress.aboutRemainingStatus', { value1: formatClock(status.progressRemainingMs) }) : t('shell.exportDialog.progress.calculatingTimeRemainingStatus')}</span></div>
                            <div className='bar'><b style={{ width: `${percent}%` }} /></div>
                        </div>
                    </div>
                </div>
            </div>
            <ExportEngineReasonView status={status} onCopy={text => session.copyLicenseCredits(text)} />
            <div className='pf'>
                <span className='fn'>{t('shell.exportDialog.progress.exportContinuesCloseWindowMessage')}</span><span className='sp' />
                <button type='button' className='btn' onClick={props.close}>{t('shell.exportDialog.progress.closeKeepWorkingAction')}</button>
                <button type='button' className='btn danger' onClick={() => void session.cancel()}>{t('shell.exportDialog.progress.cancelAction')}</button>
            </div>
        </>
    );
}
