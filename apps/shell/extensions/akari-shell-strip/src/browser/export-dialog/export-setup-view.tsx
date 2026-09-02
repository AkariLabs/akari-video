import * as React from '@theia/core/shared/react';
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
import { ExportFrame, VideoFacts } from './export-view-shared';

const ENCODER_LABELS: Readonly<Record<QuickExportEncoder, string>> = {
    auto: '自動', videotoolbox: 'VideoToolbox', nvenc: 'NVENC', qsv: 'QSV', amf: 'AMF', mf: 'MF', x264: 'x264'
};

const ENGINE_LABELS: Readonly<Record<QuickExportEngine, string>> = {
    auto: '自動', gpu: 'GPU', osr: 'OSR'
};

const CODEC_LABELS: Readonly<Record<ExportSettings['codec'], string>> = {
    h264: 'MP4 · H.264', hevc: 'MP4 · H.265（HEVC）'
};

function encoderAvailable(encoder: QuickExportEncoder): boolean {
    if (encoder === 'auto' || encoder === 'x264') return true;
    if (OS.type() === OS.Type.OSX) return encoder === 'videotoolbox';
    if (OS.type() === OS.Type.Windows) return ['nvenc', 'qsv', 'amf', 'mf'].includes(encoder);
    return false;
}

function qualityMeta(quality: QuickExportQuality): { label: string; crf: number; hardwareMbps?: number } {
    switch (quality) {
        case 'master': return { label: 'マスター', crf: 15 };
        case 'high': return { label: '高画質', crf: 18, hardwareMbps: 12 };
        case 'light': return { label: '軽量', crf: 26, hardwareMbps: 5 };
        default: return { label: '標準', crf: 23, hardwareMbps: 8 };
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
                    <div className='sec'><span>この動画</span><span className='r'>edit.json の出力設定</span></div>
                    <ExportFrame video={snapshot.video} />
                    <VideoFacts video={snapshot.video} />
                    <p className='fine'>画角・長さ・fps は編集が決めたもの。ここでは変えられません。</p>
                    <div className='outsum'>
                        <span className='h'>この設定で出るもの</span>
                        {descriptions.map(line => (
                            <React.Fragment key={line.label}><span>{line.label}</span><b>{line.value}</b></React.Fragment>
                        ))}
                    </div>
                </div>
                <div className={`rwrap${hasMore ? ' more' : ''}`}>
                    <div className='right' ref={rightRef} onScroll={checkMore}>
                        <div className='sec'><span>どう出す？</span><span className='r'>目安 · 設定を変えると更新</span></div>
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
                                        <span><span className='nm'>{choice.label}{choice.recommended && <small>推奨</small>}</span><span className='ds'>{choice.description}</span></span>
                                        <span className='est'><b>{estimate.time}</b>{estimate.size}<span className='enc'>crf {choice.crf} · HW {choice.hardwareMbps} Mbps</span></span>
                                    </button>
                                );
                            })}
                        </div>

                        <div className='sec mt18'><span>保存先</span></div>
                        <div className='row'>
                            <div className='field'>
                                <span className='dir'>{snapshot.settings.outputDirectoryUri ? '選択先/' : 'exports/'}</span>
                                <span className='nm'>{snapshot.outputName}</span>
                            </div>
                            <button type='button' className='btn' onClick={() => void session.chooseOutputDirectory()}>変更…</button>
                        </div>
                        <p className='fine'>同じ名前があれば final-2.mp4 にします。上書きはしません。</p>

                        <button
                            type='button'
                            className='protoggle'
                            aria-expanded={detailsOpen}
                            onClick={() => setDetailsOpen(open => !open)}
                        >
                            <span className='car' /><span className='lb'>詳細設定</span>
                            <span className='sum'>{CODEC_LABELS[snapshot.settings.codec]} / {ENGINE_LABELS[snapshot.settings.engine]} / {ENCODER_LABELS[snapshot.settings.encoder]} / AAC −14 LUFS</span>
                        </button>

                        {detailsOpen && (
                            <div className='pro'>
                                <div className='legend'><span className='soon-tag'>近日</span>= まだ選べないが、この席に来る設定。薄い項目 = この端末にはないもの。</div>

                                <div className='pg'>
                                    <div className='sec'><span>形式</span><span className='r'>コンテナ · コーデック</span></div>
                                    <div className='fmt'>
                                        {EXPORT_FORMAT_SEATS.map(seat => {
                                            const codec = isFormatSelectable(seat.id) ? seat.id : undefined;
                                            return (
                                                <button type='button' className={`fm${snapshot.settings.codec === seat.id ? ' on' : seat.available ? '' : ' soon'}`} disabled={codec === undefined} title={seat.tooltip} key={seat.id} onClick={codec ? () => update({ codec }) : undefined}>
                                                    <b>{seat.label}</b><small>{seat.description}</small><em className='ex'>出口: {seat.exit}</em>
                                                    {!seat.available && <i className='soon-tag'>近日</i>}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div className='pg'>
                                    <div className='sec'><span>エンジン</span><span className='r'>描画経路</span></div>
                                    <div className='seg'>
                                        {(['auto', 'gpu', 'osr'] as const).map(engine => (
                                            <SegButton key={engine} selected={snapshot.settings.engine === engine} onClick={() => update({ engine })}>{ENGINE_LABELS[engine]}</SegButton>
                                        ))}
                                    </div>
                                </div>

                                <div className='pg'>
                                    <div className='sec'><span>エンコーダ</span><span className='r'>この端末で使えるもの</span></div>
                                    <div className='seg'>
                                        {(Object.keys(ENCODER_LABELS) as QuickExportEncoder[]).map(encoder => {
                                            const available = encoderAvailable(encoder);
                                            return <SegButton key={encoder} selected={snapshot.settings.encoder === encoder} disabled={!available} unavailable={!available} title={!available ? 'この端末では利用できません' : undefined} onClick={() => update({ encoder })}>{ENCODER_LABELS[encoder]}</SegButton>;
                                        })}
                                    </div>
                                    <p className='fine'>自動 = ハードウェアが使えれば優先、無ければ x264。</p>
                                </div>

                                <div className='pg'>
                                    <div className='sec'><span>画質</span></div>
                                    <div className='seg'>
                                        {(['light', 'standard', 'high', 'master'] as QuickExportQuality[]).map(quality => {
                                            const meta = qualityMeta(quality);
                                            const masterDisabled = quality === 'master' && !isMasterSelectable(snapshot.settings.encoder);
                                            return <SegButton key={quality} selected={snapshot.settings.quality === quality} disabled={masterDisabled} unavailable={masterDisabled} title={masterDisabled ? 'マスターは x264 のときだけ選べます' : undefined} onClick={() => update({ quality })}>{meta.label} <u>crf {meta.crf}</u></SegButton>;
                                        })}
                                    </div>
                                    <p className='fine'>crf = 圧縮の強さ。小さいほど高画質・大きいほど軽い。マスターは x264 のときだけ選べます。</p>
                                </div>

                                <div className='pg'>
                                    <div className='sec'><span>画素数</span><span className='r'>画角はそのまま・大きさだけ</span></div>
                                    <div className='seg'>
                                        {EXPORT_RESOLUTION_SEATS.map(seat => {
                                            const resolution = seat.id === 'source' ? 'native' : seat.id;
                                            const selectable = resolution !== 'unlock-aspect';
                                            return <SegButton key={seat.id} selected={selectable && snapshot.settings.resolution === resolution} disabled={!seat.available} soon={!seat.available} title={seat.tooltip} onClick={selectable ? () => update({ resolution: resolution as ExportSettings['resolution'] }) : undefined}>
                                                {seat.id === 'source' && snapshot.video.width && snapshot.video.height ? `そのまま ${snapshot.video.width}×${snapshot.video.height}` : seat.label}
                                            </SegButton>;
                                        })}
                                    </div>
                                    {snapshot.settings.resolution === 'custom' && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
                                            <label className='fine' htmlFor='akari-export-custom-width' style={{ margin: 0 }}>幅</label>
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
                                    {outputResolution.mode === 'up' && <p className='fine'>{sourceShortEdge}p から補間します</p>}
                                    <p className='fine'>720p / 1440p / 4K / 自由指定は画角を保ちます。「画角を外す」は近日対応です。</p>
                                </div>

                                <div className='pg'>
                                    <div className='sec'><span>フレームレート</span></div>
                                    <div className='seg'>
                                        <SegButton selected={snapshot.settings.fps === undefined} onClick={() => update({ fps: undefined })}>そのまま（{snapshot.video.fps ?? '—'}）</SegButton>
                                        {[24, 30, 60].map(fps => <SegButton key={fps} selected={snapshot.settings.fps === fps} onClick={() => update({ fps })}>{fps}</SegButton>)}
                                    </div>
                                </div>

                                <div className='pg'>
                                    <div className='sec'><span>音</span><span className='r'>48 kHz は固定</span></div>
                                    <div className='kvgrid'>
                                        {EXPORT_AUDIO_SEATS.map(seat => (
                                            <React.Fragment key={seat.id}>
                                                <span>{seat.id === 'aac' ? 'コーデック' : seat.label}</span>
                                                <div className='with'><div className='seg'><SegButton selected={seat.available} disabled={!seat.available} soon={!seat.available} title={seat.tooltip}>{seat.available ? seat.label : seat.description}</SegButton></div>{!seat.available && <i className='soon-tag'>近日</i>}</div>
                                            </React.Fragment>
                                        ))}
                                    </div>
                                </div>

                                <div className='pg'>
                                    <div className='sec'><span>色</span><span className='r'>ビット深度 · カラースペース</span></div>
                                    <div className='kvgrid'>
                                        {EXPORT_COLOR_SEATS.map(seat => (
                                            <React.Fragment key={seat.id}>
                                                <span>{seat.label}</span>
                                                <div className='with'><div className='seg'><SegButton selected={seat.available} disabled={!seat.available} soon={!seat.available} title={seat.tooltip}>{seat.description}</SegButton></div>{!seat.available && <i className='soon-tag'>近日</i>}</div>
                                            </React.Fragment>
                                        ))}
                                    </div>
                                </div>

                                <div className='pg'>
                                    <div className='sec'><span>書き出す前に</span></div>
                                    <div className='kvgrid'>
                                        <span>lint</span><button type='button' className='chk' onClick={() => update({ rerunLint: !snapshot.settings.rerunLint })}><i className={snapshot.settings.rerunLint ? 'on' : ''} />lint を再実行</button>
                                        <span>プリセット保存</span><button type='button' className='chk' onClick={() => update({ saveAsDefault: !snapshot.settings.saveAsDefault })}><i className={snapshot.settings.saveAsDefault ? 'on' : ''} />この設定を既定にする</button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
            <div className='pf'>
                <button type='button' className='btn ghost' onClick={() => void session.handOffToPartner()}>パートナーに任せる</button>
                <span className='fn'>AI チャットに入ります</span><span className='sp' />
                <button type='button' className='btn primary' onClick={() => void session.start()}>書き出す <small>— {selected.label} · {session.estimate().time}</small></button>
            </div>
        </>
    );
}
