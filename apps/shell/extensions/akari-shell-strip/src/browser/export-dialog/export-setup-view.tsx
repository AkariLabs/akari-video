import { t } from '../../common/shell-text';
import * as React from '@theia/core/shared/react';
import { ExportLicenseView } from './export-license-view';
import { OS } from '@theia/core/lib/common/os';
import {
    describeOutput,
    EXPORT_AUDIO_SEATS,
    EXPORT_COLOR_SEATS,
    EXPORT_FORMAT_SEATS,
    EXPORT_QUALITY_CHOICES,
    EXPORT_RESOLUTION_SEATS,
    ExportSettings,
    isFormatSelectable,
    isMasterSelectable,
    resolveOutputResolution
} from '../../common/export-settings';
import { QuickExportEncoder, QuickExportEngine, QuickExportQuality } from '../../common/quick-export-cli';
import { AkariExportSessionService, ExportSessionSnapshot } from '../akari-export-session-service';
import { ExportFrame, formatBytes, VideoFacts } from './export-view-shared';

const ENCODER_LABELS: Readonly<Record<QuickExportEncoder, string>> = {
    get auto() { return t('shell.exportDialog.setup.autoLabel'); }, videotoolbox: 'VideoToolbox', nvenc: 'NVENC', qsv: 'QSV', amf: 'AMF', mf: 'MF', x264: 'x264'
};

const ENGINE_LABELS: Readonly<Record<QuickExportEngine, string>> = {
    get auto() { return t('shell.exportDialog.setup.autoLabel'); }, gpu: 'GPU', osr: 'OSR'
};

const CODEC_LABELS: Readonly<Record<ExportSettings['codec'], string>> = {
    h264: 'MP4 · H.264', get hevc() { return t('shell.exportDialog.setup.mp4H265HevcText'); },
    prores422: 'MOV · ProRes 422 HQ', get png() { return t('shell.exportDialog.setup.pngSequenceLabel'); }
};

const AUDIO_LABELS: Readonly<Record<ExportSettings['codec'], string>> = {
    h264: 'AAC', hevc: 'AAC', prores422: 'PCM', png: 'WAV'
};

function encoderAvailable(encoder: QuickExportEncoder): boolean {
    if (encoder === 'auto' || encoder === 'x264') return true;
    if (OS.type() === OS.Type.OSX) return encoder === 'videotoolbox';
    if (OS.type() === OS.Type.Windows) return ['nvenc', 'qsv', 'amf', 'mf'].includes(encoder);
    return false;
}

function qualityMeta(quality: QuickExportQuality): { label: string; crf: number; hardwareMbps?: number } {
    switch (quality) {
        case 'master': return { label: t('shell.exportDialog.setup.masterLabel'), crf: 15 };
        case 'high': return { label: t('shell.exportDialog.setup.highQualityLabel'), crf: 18, hardwareMbps: 12 };
        case 'light': return { label: t('shell.exportDialog.setup.compactLabel'), crf: 26, hardwareMbps: 5 };
        default: return { label: t('shell.exportDialog.setup.standardLabel'), crf: 23, hardwareMbps: 8 };
    }
}

function SegButton(props: {
    selected?: boolean;
    disabled?: boolean;
    soon?: boolean;
    unavailable?: boolean;
    title?: string;
    onClick?: () => void;
    children: React.ReactNode;
}): React.ReactNode {
    return (
        <button
            type='button'
            className={`${props.selected ? 'on ' : ''}${props.soon ? 'soon ' : ''}${props.unavailable ? 'na' : ''}`.trim()}
            disabled={props.disabled}
            title={props.title}
            onClick={props.onClick}
        >{props.children}</button>
    );
}

export function ExportSetupView(props: {
    session: AkariExportSessionService;
    snapshot: ExportSessionSnapshot;
}): React.ReactNode {
    const { session, snapshot } = props;
    const [detailsOpen, setDetailsOpen] = React.useState(false);
    const [hasMore, setHasMore] = React.useState(false);
    const rightRef = React.useRef<HTMLDivElement>(null);
    const selected = qualityMeta(snapshot.settings.quality);
    const descriptions = describeOutput(snapshot.settings, snapshot.editJson);
    const outputResolution = resolveOutputResolution(snapshot.video, snapshot.settings);
    const sourceShortEdge = snapshot.video.width && snapshot.video.height
        ? Math.min(snapshot.video.width, snapshot.video.height)
        : 1080;

    const checkMore = React.useCallback(() => {
        const node = rightRef.current;
        setHasMore(Boolean(node && node.scrollHeight - node.scrollTop - node.clientHeight > 6));
    }, []);

    React.useLayoutEffect(() => {
        checkMore();
        const node = rightRef.current;
        if (!node || typeof ResizeObserver === 'undefined') return undefined;
        const observer = new ResizeObserver(checkMore);
        observer.observe(node);
        return () => observer.disconnect();
    }, [checkMore, detailsOpen, snapshot.settings]);

    const update = (patch: Partial<ExportSettings>): void => session.updateSettings(patch);

    return (
        <>
            <div className='pb'>
                <div className='left'>
                    <div className='sec'><span>{t('shell.exportDialog.setup.videoLabel')}</span><span className='r'>{t('shell.exportDialog.setup.editJsonOutputSettingsText')}</span></div>
                    <ExportFrame video={snapshot.video} />
                    <VideoFacts video={snapshot.video} />
                    <p className='fine'>{t('shell.exportDialog.setup.editDeterminesOrientationDurationFpsCannotChangeThemHereMessage')}</p>
                    <div className='outsum'>
                        <span className='h'>{t('shell.exportDialog.setup.expectedOutputLabel')}</span>
                        {descriptions.map(line => (
                            <React.Fragment key={line.label}><span>{line.label}</span><b>{line.value}</b></React.Fragment>
                        ))}
                    </div>
                </div>
                <div className={`rwrap${hasMore ? ' more' : ''}`}>
                    <div className='right' ref={rightRef} onScroll={checkMore}>
                        <div className='sec'><span>{t('shell.exportDialog.setup.howShouldExportMessage')}</span><span className='r'>{t('shell.exportDialog.setup.estimateUpdatesSettingsChangeText')}</span></div>
                        <div className='opts'>
                            {EXPORT_QUALITY_CHOICES.map(choice => {
                                const estimate = session.estimate(choice.id);
                                return (
                                    <button
                                        type='button'
                                        className={`opt${snapshot.settings.quality === choice.id ? ' on' : ''}`}
                                        key={choice.id}
                                        onClick={() => update({ quality: choice.id })}
                                    >
                                        <span className='rd' />
                                        <span><span className='nm'>{choice.label}{choice.recommended && <small>{t('shell.exportDialog.setup.recommendedStatus')}</small>}</span><span className='ds'>{choice.description}</span></span>
                                        <span className='est'><b>{estimate.time}</b>{estimate.size}<span className='enc'>crf {choice.crf} · HW {choice.hardwareMbps} Mbps</span></span>
                                    </button>
                                );
                            })}
                        </div>

                        <div className='sec mt18'><span>{t('shell.exportDialog.setup.saveAction')}</span></div>
                        <div className='row'>
                            <div className='field'>
                                <span className='dir'>{snapshot.settings.outputDirectoryUri ? t('shell.exportDialog.setup.selectedFolderLabel') : 'exports/'}</span>
                                <span className='nm'>{snapshot.outputName}</span>
                            </div>
                            <button type='button' className='btn' onClick={() => void session.chooseOutputDirectory()}>{t('shell.exportDialog.setup.changeAction')}</button>
                        </div>
                        <p className='fine'>{t('shell.exportDialog.setup.fileName2AddedNothingOverwrittenMessage')}</p>

                        <button
                            type='button'
                            className='protoggle'
                            aria-expanded={detailsOpen}
                            onClick={() => setDetailsOpen(open => !open)}
                        >
                            <span className='car' /><span className='lb'>{t('shell.exportDialog.setup.advancedSettingsLabel')}</span>
                            <span className='sum'>{CODEC_LABELS[snapshot.settings.codec]} / {ENGINE_LABELS[snapshot.settings.engine]} / {ENCODER_LABELS[snapshot.settings.encoder]} / {AUDIO_LABELS[snapshot.settings.codec]} −14 LUFS</span>
                        </button>

                        {detailsOpen && (
                            <div className='pro'>
                                <div className='legend'><span className='soon-tag'>{t('shell.exportDialog.setup.comingSoonLabel')}</span>{t('shell.exportDialog.setup.notSelectableYetButPlannedHereDimmedUnavailableDeviceStatus')}</div>

                                <div className='pg'>
                                    <div className='sec'><span>{t('shell.exportDialog.setup.formatLabel')}</span><span className='r'>{t('shell.exportDialog.setup.containerCodecLabel')}</span></div>
                                    <div className='fmt'>
                                        {EXPORT_FORMAT_SEATS.map(seat => {
                                            const codec = isFormatSelectable(seat.id) ? seat.id : undefined;
                                            return (
                                                <button type='button' className={`fm${snapshot.settings.codec === seat.id ? ' on' : seat.available ? '' : ' soon'}`} disabled={codec === undefined} title={seat.tooltip} key={seat.id} onClick={codec ? () => update({ codec }) : undefined}>
                                                    <b>{seat.label}</b><small>{seat.description}</small><em className='ex'>{t('shell.exportDialog.setup.outputLabel')}{seat.exit}</em>
                                                    {!seat.available && <i className='soon-tag'>{t('shell.exportDialog.setup.comingSoonLabel')}</i>}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div className='pg'>
                                    <div className='sec'><span>{t('shell.exportDialog.setup.engineLabel')}</span><span className='r'>{t('shell.exportDialog.setup.renderingPathLabel')}</span></div>
                                    <div className='seg'>
                                        {(['auto', 'gpu', 'osr'] as const).map(engine => (
                                            <SegButton key={engine} selected={snapshot.settings.engine === engine} onClick={() => update({ engine })}>{ENGINE_LABELS[engine]}</SegButton>
                                        ))}
                                    </div>
                                </div>

                                <div className='pg'>
                                    <div className='sec'><span>{t('shell.exportDialog.setup.encoderLabel')}</span><span className='r'>{t('shell.exportDialog.setup.availableDeviceLabel')}</span></div>
                                    <div className='seg'>
                                        {(Object.keys(ENCODER_LABELS) as QuickExportEncoder[]).map(encoder => {
                                            const available = encoderAvailable(encoder);
                                            return <SegButton key={encoder} selected={snapshot.settings.encoder === encoder} disabled={!available} unavailable={!available} title={!available ? t('shell.exportDialog.setup.unavailableDeviceStatus') : undefined} onClick={() => update({ encoder })}>{ENCODER_LABELS[encoder]}</SegButton>;
                                        })}
                                    </div>
                                    <p className='fine'>{t('shell.exportDialog.setup.autoPrefersHardwareAvailableOtherwiseX264Message')}</p>
                                </div>

                                <div className='pg'>
                                    <div className='sec'><span>{t('shell.exportDialog.setup.qualityLabel')}</span></div>
                                    <div className='seg'>
                                        {(['light', 'standard', 'high', 'master'] as QuickExportQuality[]).map(quality => {
                                            const meta = qualityMeta(quality);
                                            const masterDisabled = quality === 'master' && !isMasterSelectable(snapshot.settings.encoder);
                                            return <SegButton key={quality} selected={snapshot.settings.quality === quality} disabled={masterDisabled} unavailable={masterDisabled} title={masterDisabled ? t('shell.exportDialog.setup.masterAvailableX264Text') : undefined} onClick={() => update({ quality })}>{meta.label} <u>crf {meta.crf}</u></SegButton>;
                                        })}
                                    </div>
                                    <p className='fine'>{t('shell.exportDialog.setup.crfControlsCompressionLowerMeansHigherQualityHigherMeansSmallerMessage')}</p>
                                </div>

                                <div className='pg'>
                                    <div className='sec'><span>{t('shell.exportDialog.setup.resolutionLabel')}</span><span className='r'>{t('shell.exportDialog.setup.keepOrientationChangeSizeText')}</span></div>
                                    <div className='seg'>
                                        {EXPORT_RESOLUTION_SEATS.map(seat => {
                                            const resolution = seat.id === 'source' ? 'native' : seat.id;
                                            const selectable = resolution !== 'unlock-aspect';
                                            return <SegButton key={seat.id} selected={selectable && snapshot.settings.resolution === resolution} disabled={!seat.available} soon={!seat.available} title={seat.tooltip} onClick={selectable ? () => update({ resolution: resolution as ExportSettings['resolution'] }) : undefined}>
                                                {seat.id === 'source' && snapshot.video.width && snapshot.video.height ? t('shell.exportDialog.setup.keepAction', { value1: snapshot.video.width, value2: snapshot.video.height }) : seat.label}
                                            </SegButton>;
                                        })}
                                    </div>
                                    {snapshot.settings.resolution === 'custom' && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
                                            <label className='fine' htmlFor='akari-export-custom-width' style={{ margin: 0 }}>{t('shell.exportDialog.setup.widthLabel')}</label>
                                            <input
                                                id='akari-export-custom-width'
                                                type='number'
                                                min={320}
                                                max={7680}
                                                step={2}
                                                value={outputResolution.width}
                                                onChange={event => update({ customWidth: Number(event.currentTarget.value) })}
                                                style={{ width: '92px' }}
                                            />
                                            <span className='fine' style={{ margin: 0 }}>× {outputResolution.height}</span>
                                        </div>
                                    )}
                                    {outputResolution.mode === 'up' && <p className='fine'>{sourceShortEdge}{t('shell.exportDialog.setup.interpolatedPLabel')}</p>}
                                    <p className='fine'>{t('shell.exportDialog.setup.value720p1440p4kCustomPreserveOrientationUnlockOrientationComingSoonMessage')}</p>
                                </div>

                                <div className='pg'>
                                    <div className='sec'><span>{t('shell.exportDialog.setup.frameRateLabel')}</span></div>
                                    <div className='seg'>
                                        <SegButton selected={snapshot.settings.fps === undefined} onClick={() => update({ fps: undefined })}>{t('shell.exportDialog.setup.keepCurrentAction')}{snapshot.video.fps ?? '—'}）</SegButton>
                                        {[24, 30, 60].map(fps => <SegButton key={fps} selected={snapshot.settings.fps === fps} onClick={() => update({ fps })}>{fps}</SegButton>)}
                                    </div>
                                </div>

                                <div className='pg'>
                                    <div className='sec'><span>{t('shell.exportDialog.setup.audioLabel')}</span><span className='r'>{t('shell.exportDialog.setup.fixed48KhzText')}</span></div>
                                    <div className='kvgrid'>
                                        {EXPORT_AUDIO_SEATS.map(seat => (
                                            <React.Fragment key={seat.id}>
                                                <span>{seat.id === 'aac' ? t('shell.exportDialog.setup.codecLabel') : seat.label}</span>
                                                <div className='with'><div className='seg'><SegButton selected={seat.available} disabled={!seat.available} soon={!seat.available} title={seat.tooltip}>{seat.id === 'aac' ? `${AUDIO_LABELS[snapshot.settings.codec]} 48 kHz` : seat.available ? seat.label : seat.description}</SegButton></div>{!seat.available && <i className='soon-tag'>{t('shell.exportDialog.setup.comingSoonLabel')}</i>}</div>
                                            </React.Fragment>
                                        ))}
                                    </div>
                                </div>

                                <div className='pg'>
                                    <div className='sec'><span>{t('shell.exportDialog.setup.colorLabel')}</span><span className='r'>{t('shell.exportDialog.setup.bitDepthColorSpaceText')}</span></div>
                                    <div className='kvgrid'>
                                        {EXPORT_COLOR_SEATS.map(seat => (
                                            <React.Fragment key={seat.id}>
                                                <span>{seat.label}</span>
                                                <div className='with'><div className='seg'><SegButton selected={seat.available} disabled={!seat.available} soon={!seat.available} title={seat.tooltip}>{seat.description}</SegButton></div>{!seat.available && <i className='soon-tag'>{t('shell.exportDialog.setup.comingSoonLabel')}</i>}</div>
                                            </React.Fragment>
                                        ))}
                                    </div>
                                </div>

                                <div className='pg'>
                                    <div className='sec'><span>{t('shell.exportDialog.setup.exportingStatus')}</span></div>
                                    <div className='kvgrid'>
                                        <span>lint</span><button type='button' className='chk' onClick={() => update({ rerunLint: !snapshot.settings.rerunLint })}><i className={snapshot.settings.rerunLint ? 'on' : ''} />{t('shell.exportDialog.setup.runLintAgainAction')}</button>
                                        <span>{t('shell.exportDialog.setup.savePresetAction')}</span><button type='button' className='chk' onClick={() => update({ saveAsDefault: !snapshot.settings.saveAsDefault })}><i className={snapshot.settings.saveAsDefault ? 'on' : ''} />{t('shell.exportDialog.setup.makeTheseSettingsDefaultText')}</button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
            <ExportLicenseView findings={snapshot.licenseFindings} onCopy={text => session.copyLicenseCredits(text)} />
            <CancelledLeftoverBanner session={session} snapshot={snapshot} />
            <div className='pf'>
                <button type='button' className='btn ghost' onClick={() => void session.handOffToPartner()}>{t('shell.exportDialog.setup.leavePartnerLabel')}</button>
                <span className='fn'>{t('shell.exportDialog.setup.opensAiChatText')}</span><span className='sp' />
                <button type='button' className='btn primary' data-akari-onboarding-target='export-submit' onClick={() => void session.start()}>{t('shell.exportDialog.setup.exportAction')}<small>— {selected.label} · {session.estimate().time}</small></button>
            </div>
        </>
    );
}

/**
 * 中止した回の作業ディレクトリ（`.akari/render-tmp/<実行 ID>/`）が残っているときだけ
 * 出す片付け導線。押されたときだけ消す — 掃除で再生成不可のデータを失った issue #46 の
 * 反省から、勝手には消さないし、消す対象もその回の entry に限る。
 */
function CancelledLeftoverBanner(props: {
    session: AkariExportSessionService;
    snapshot: ExportSessionSnapshot;
}): React.ReactNode {
    const { session, snapshot } = props;
    const leftover = snapshot.status.cancelledLeftover;
    if (!leftover || leftover.entries.length === 0) {
        return undefined;
    }
    const busy = snapshot.discardingLeftover;
    return (
        <div
            style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
                borderTop: '1px solid var(--theia-editorWidget-border)',
                background: 'var(--theia-editorWidget-background)', fontSize: '0.85em'
            }}
        >
            <span className='codicon codicon-trash' aria-hidden='true' />
            <span>
                {t('shell.exportDialog.setup.temporaryFilesCanceledExportStatus').trimStart()}<b>{formatBytes(leftover.bytes)}</b> {t('shell.exportDialog.setup.remainLabel').trimEnd()}{leftover.entries.length > 1 && t('shell.exportDialog.setup.itemsLabel', { value1: leftover.entries.length, n: leftover.entries.length })}
            </span>
            <span style={{ marginLeft: 'auto' }} />
            <button
                type='button'
                className='btn'
                disabled={busy}
                title={leftover.entries.join('\n')}
                onClick={() => void session.discardLeftover()}
            >{busy ? t('shell.exportDialog.setup.deletingStatus') : t('shell.exportDialog.setup.deleteAction')}</button>
        </div>
    );
}
