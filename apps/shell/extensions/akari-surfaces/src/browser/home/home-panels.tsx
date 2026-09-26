import * as React from '@theia/core/shared/react';
import * as ReactDOM from '@theia/core/shared/react-dom';
import { HomeStats } from './home-model';

// 帯 v2（2026-09-26 オーナー指摘「幅が狭いとサムネイルがいきなり巨大になる・
// ボタンが多すぎて認知負荷が高い」）:
//   * サムネは常に小さい固定幅の列。**狭くなっても 1 列へ畳まない** —
//     畳むと絵が面いっぱいに広がる（巨大化の原因はこれだった）。
//   * 帯の中のボタンは全廃（続きから編集 / Finder で表示 / 書き出し /
//     プロジェクト・ランチャー）。Finder はパス行のクリックが担い、
//     編集・書き出し・ランチャーはそれぞれの本来の導線（タブ・メニュー・
//     ランチャーコマンド）に任せる。
//   * チャンネル名は「弱い 1 行」。切り替えはプロジェクト・ランチャー側へ移した
//     （帯に残るのは押せるテキストだけで、ボタンの枠は持たない）。
export const homePanelCss = `
.akari-current-label{font-size:11px;font-weight:600;line-height:1.3;color:var(--theia-descriptionForeground);margin:0 0 7px}
.akari-current-band{background:var(--theia-sideBar-background);border:1px solid var(--theia-widget-border);border-radius:12px;padding:13px 15px;display:grid;grid-template-columns:minmax(0,152px) minmax(0,1fr);gap:15px;align-items:start;margin-bottom:18px}
.akari-current-art{min-width:0}
.akari-current-hero{display:block;position:relative;width:100%;aspect-ratio:16/9;border:0;border-radius:7px;overflow:hidden;background:var(--theia-editor-background);cursor:pointer;padding:0;color:var(--theia-foreground)}
.akari-current-hero-empty{box-sizing:border-box;display:flex;align-items:center;justify-content:center;cursor:default;background:linear-gradient(145deg,color-mix(in srgb,var(--theia-sideBar-background) 94%,var(--akari-accent,var(--theia-focusBorder)) 6%),var(--theia-list-hoverBackground));border:1px solid var(--theia-widget-border)}
.akari-current-empty-icon{width:24px;height:24px;color:var(--akari-accent,var(--theia-focusBorder));opacity:.6}
.akari-current-empty-title{font-size:13px;font-weight:600}
.akari-current-empty-hint{max-width:100%;font-size:11px;text-wrap:balance;color:var(--theia-descriptionForeground)}
.akari-current-hero-preview-placeholder{cursor:pointer}
.akari-current-hero-preview-placeholder:hover{border-color:var(--akari-accent,var(--theia-focusBorder))}
.akari-current-hero img,.akari-current-thumbnails img{width:100%;height:100%;object-fit:contain}
.akari-current-play{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);border-radius:100%;background:rgba(0,0,0,.65);color:white;padding:7px;font-size:12px;line-height:1}
.akari-current-thumbnails{display:flex;gap:4px;margin-top:5px}.akari-current-thumbnails img{width:calc((100% - 16px)/5);aspect-ratio:16/9;border-radius:3px;background:var(--theia-editor-background);object-fit:cover}
.akari-current-thumbnail-empty{box-sizing:border-box;width:calc((100% - 16px)/5);aspect-ratio:16/9;border-radius:3px;border:1px solid var(--theia-widget-border);background:color-mix(in srgb,var(--theia-sideBar-background) 80%,var(--theia-list-hoverBackground) 20%)}
.akari-current-detail{min-width:0;display:flex;flex-direction:column}
.akari-current-name{font-size:17px;margin:0 0 3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.akari-current-crumb{display:flex;align-items:center;gap:6px;min-width:0;margin:0 0 4px}
.akari-current-tag{display:inline-flex;align-items:center;gap:4px;max-width:100%;border:0;background:none;padding:0;margin:0;min-height:auto;height:auto;font:inherit;font-size:11px;color:var(--theia-descriptionForeground);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}
.akari-current-tag:hover{color:var(--theia-foreground);text-decoration:underline}
.akari-current-tag .codicon{font-size:11px;opacity:.7}
.akari-current-path{display:inline-flex;align-items:center;gap:5px;border:0;background:none;color:var(--theia-descriptionForeground);font:inherit;font-size:11px;text-align:left;padding:0;min-width:0;max-width:100%;cursor:pointer}
.akari-current-path:hover{color:var(--theia-foreground);text-decoration:underline}
.akari-current-path .codicon{font-size:12px;flex:0 0 auto;opacity:.75}
.akari-current-path span.p{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.akari-current-note{margin:7px 0 0;font-size:11px;color:var(--theia-descriptionForeground);display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.akari-current-note button{border:0;background:none;padding:0;margin:0;min-height:auto;height:auto;font:inherit;font-size:11px;color:var(--akari-accent,var(--theia-focusBorder));cursor:pointer;text-decoration:underline}
.akari-current-stats{display:flex;flex-wrap:wrap;gap:6px 16px;margin:11px 0 0}.akari-current-stat{display:flex;flex-direction:column;gap:2px;min-width:50px}.akari-current-stat span{color:var(--theia-descriptionForeground);font-size:10.5px}.akari-current-stat b{font-size:13px}
.akari-home-topbar{display:flex;align-items:center;justify-content:flex-end;gap:8px;min-width:0;margin:0 0 9px}
.akari-store-badge{display:inline-flex;align-items:center;gap:6px;max-width:100%;min-width:0;height:22px;padding:0 9px;border-radius:999px;border:1px solid var(--theia-widget-border);background:none;color:var(--theia-descriptionForeground);font:inherit;font-size:11.5px;line-height:1;white-space:nowrap;cursor:pointer;min-height:auto}
.akari-store-badge:hover{color:var(--theia-foreground);background:var(--theia-list-hoverBackground)}
.akari-store-badge .codicon{font-size:12px;flex:0 0 auto}
.akari-store-badge .who{overflow:hidden;text-overflow:ellipsis;min-width:0}
.akari-store-badge .plan{flex:0 0 auto;font-weight:700;letter-spacing:.02em}
.akari-store-badge[data-akari-plan-tone=gold]{color:var(--akari-plan-gold,#96701a);border-color:color-mix(in srgb,var(--akari-plan-gold,#96701a) 48%,transparent);background:linear-gradient(135deg,color-mix(in srgb,var(--akari-plan-gold,#96701a) 15%,transparent),color-mix(in srgb,var(--akari-plan-gold,#96701a) 7%,transparent))}
.akari-store-badge[data-akari-plan-tone=gold]:hover{border-color:color-mix(in srgb,var(--akari-plan-gold,#96701a) 78%,transparent)}
.akari-store-badge[data-akari-plan-tone=warn]{color:var(--theia-editorWarning-foreground,#9a5b00);border-color:color-mix(in srgb,var(--theia-editorWarning-foreground,#9a5b00) 46%,transparent)}
.akari-home-project-toolbar{display:flex;align-items:center;flex-wrap:nowrap;gap:7px;margin:12px 0 8px;overflow-x:auto;overflow-y:hidden;padding-bottom:2px}.akari-home-project-toolbar h3{font-size:13px;font-weight:600;color:var(--theia-descriptionForeground);margin:0 4px 0 0;flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.akari-home-project-filters{display:flex;align-items:center;flex-wrap:wrap;gap:7px;margin:0 0 4px}.akari-home-project-filters>*{flex-shrink:0}.akari-home-project-filters small{white-space:nowrap;font-size:11.5px}.akari-home-project-toolbar>*{flex-shrink:0}.akari-home-project-toolbar .akari-home-toolbar-button{display:inline-flex;align-items:center;justify-content:center;gap:4px;flex:0 0 auto;width:auto;min-height:28px;height:28px;margin:0;padding:4px 9px;font-size:11px;white-space:nowrap;line-height:1}.akari-home-project-toolbar .akari-home-toolbar-button .codicon{font-size:12px}.akari-home-project-toolbar select{flex:0 0 auto}.akari-home-project-toolbar input{flex-shrink:0}
.akari-home-sheet-scrim{position:fixed;inset:0;background:rgba(0,0,0,.58);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}
.akari-home-sheet{position:relative;background:var(--theia-sideBar-background);color:var(--theia-foreground);border:1px solid var(--theia-widget-border);box-shadow:0 20px 55px rgba(0,0,0,.35);border-radius:13px;padding:26px;width:min(620px,95vw);max-height:90vh;overflow:auto;box-sizing:border-box}
.akari-home-sheet-scrim[data-akari-home-dialog=channel-switch] .akari-home-sheet,.akari-home-sheet-scrim[data-akari-home-dialog=channel-choice] .akari-home-sheet,.akari-home-sheet-scrim[data-akari-home-dialog=channel-window-choice] .akari-home-sheet,.akari-home-sheet-scrim[data-akari-home-dialog=channel-create] .akari-home-sheet,.akari-home-sheet-scrim[data-akari-home-dialog=channel-rename] .akari-home-sheet{width:min(360px,95vw);padding:18px}
.akari-home-sheet h3{font-size:18px;margin:0 32px 8px 0}.akari-home-sheet p{color:var(--theia-descriptionForeground);font-size:12px;line-height:1.6;margin:0 0 16px}.akari-home-sheet-close{position:absolute;right:10px;top:10px;border:0;background:none;color:var(--theia-foreground);font-size:20px;cursor:pointer}
.akari-home-start-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}.akari-home-start-card{display:flex;align-items:center;gap:11px;text-align:left;background:var(--theia-editor-background);border:1px solid var(--theia-widget-border);border-radius:9px;padding:13px;color:var(--theia-foreground);cursor:pointer;min-height:74px}.akari-home-start-card:hover:not(:disabled){border-color:var(--theia-focusBorder)}.akari-home-start-card:disabled{opacity:.55;cursor:default}.akari-home-start-card[data-trial-unavailable=true]{opacity:.55;cursor:help}.akari-home-start-card .codicon{font-size:22px;color:var(--theia-focusBorder)}.akari-home-start-card b,.akari-home-start-card small{display:block}.akari-home-start-card small{color:var(--theia-descriptionForeground);margin-top:4px}.akari-home-start-card em{margin-left:auto;font-style:normal;font-size:10px;border:1px solid var(--theia-widget-border);border-radius:99px;padding:2px 6px}.akari-home-sheet p.akari-home-voice-requirement{margin:10px 0 0;color:var(--theia-focusBorder);font-size:11px}
.akari-home-choice{display:block;text-align:left;width:100%;border:1px solid var(--theia-widget-border);border-radius:8px;background:var(--theia-editor-background);color:var(--theia-foreground);padding:12px;margin:8px 0;cursor:pointer}.akari-home-choice[data-selected=true]{border-color:var(--theia-focusBorder)}.akari-home-choice small{display:block;color:var(--theia-descriptionForeground);margin-top:4px}.akari-home-dialog-path{background:var(--theia-editor-background);padding:8px;border-radius:6px;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.akari-home-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:15px}
.akari-home-channel-list{display:grid;gap:3px}.akari-home-channel-row{display:flex;align-items:center;gap:10px;border:0;background:transparent;color:var(--theia-foreground);padding:9px;text-align:left;cursor:pointer;border-radius:7px}.akari-home-channel-row:hover{background:var(--theia-list-hoverBackground)}.akari-home-channel-row small{display:block;color:var(--theia-descriptionForeground)}.akari-home-channel-rename{flex:0 0 auto;border:0;background:transparent;color:var(--theia-descriptionForeground);padding:5px;border-radius:5px;cursor:pointer;min-height:auto;height:auto}.akari-home-channel-rename:hover{color:var(--theia-foreground);background:var(--theia-list-hoverBackground)}.akari-home-channel-separator{height:1px;background:var(--theia-widget-border);margin:6px 0}.akari-home-channel-name-label{display:grid;gap:7px;font-size:12px}.akari-home-channel-name{width:100%;box-sizing:border-box}.akari-home-sheet p.akari-home-channel-error{color:var(--theia-errorForeground);margin:10px 0 0}
@container (max-width:620px){.akari-current-band{grid-template-columns:minmax(0,108px) minmax(0,1fr);gap:11px;padding:11px 12px}.akari-current-thumbnails{display:none}.akari-current-name{font-size:15px}.akari-home-start-grid{grid-template-columns:1fr}}
@container (max-width:420px){.akari-current-band{grid-template-columns:minmax(0,78px) minmax(0,1fr);gap:9px}.akari-current-stats{gap:5px 12px}}
`;

export function HomeScrim(props: { kind: string; onClose: () => void; children: React.ReactNode }): React.ReactPortal {
    React.useEffect(() => {
        const close = (event: KeyboardEvent): void => { if (event.key === 'Escape') { props.onClose(); } };
        document.addEventListener('keydown', close);
        return () => document.removeEventListener('keydown', close);
    }, [props.onClose]);
    return ReactDOM.createPortal(<div className='akari-home-sheet-scrim' data-akari-home-dialog={props.kind} onMouseDown={event => { if (event.target === event.currentTarget) { props.onClose(); } }}>
        <div className='akari-home-sheet' role='dialog' aria-modal='true'><button type='button' className='akari-home-sheet-close' aria-label='閉じる' onClick={props.onClose}>×</button>{props.children}</div>
    </div>, document.body);
}

export interface CurrentProjectBandProps {
    name: string; channel?: string; path: string; frames: string[]; stats: HomeStats; canPreview: boolean;
    onPreview: () => void; onStart: () => void; onReveal: () => void; onSwitch: () => void; onJoin: () => void;
}
function CurrentThumbnail(p: { src?: string; index: number }): React.ReactElement {
    const [failedSrc, setFailedSrc] = React.useState<string | undefined>();
    return p.src && p.src !== failedSrc
        ? <img src={p.src} alt='' data-akari-current-thumbnail={p.index} onError={() => setFailedSrc(p.src)} />
        : <span className='akari-current-thumbnail-empty' data-akari-current-thumbnail={p.index} />;
}
function EmptyFilmIcon(): React.ReactElement {
    return <svg className='akari-current-empty-icon' viewBox='0 0 32 32' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'><rect x='3' y='7' width='26' height='18' rx='3' /><path d='M11 7v18M21 7v18M3 12h8m-8 8h8m10-8h8m-8 8h8' /></svg>;
}
export function CurrentProjectBand(p: CurrentProjectBandProps): React.ReactElement {
    const [failedPosterSrc, setFailedPosterSrc] = React.useState<string | undefined>();
    const poster = p.frames[0] !== failedPosterSrc && p.frames[0];
    const values: Array<[string, string | undefined]> = [['尺', p.stats.duration], ['クリップ', p.stats.clips], ['素材', p.stats.assets], ['データ量', p.stats.bytes], ['最後の書き出し', p.stats.lastExport]];
    // 絵が用意できないときの 1 行。帯の中ではなく詳細側の弱い注記として出す
    // （小さなサムネ枠の中に文とボタンを詰め込むと、狭い幅で真っ先に壊れる）。
    const note = poster ? undefined : p.canPreview
        ? <p className='akari-current-note'><span className='akari-current-empty-title'>サムネイルはありません</span></p>
        : <p className='akari-current-note'>
            <span className='akari-current-empty-title'>まだ映像がありません</span>
            <button type='button' onClick={p.onStart}>素材を入れて始める</button>
            <span className='akari-current-empty-hint'>素材をドラッグしても取り込めます</span>
        </p>;
    return <section className='akari-current-project' data-akari-current-location='true' data-akari-status-kind={p.channel ? 'inside' : 'outside'}>
        <p className='akari-current-label'>いま開いているプロジェクト</p>
        <div className='akari-current-band' data-akari-current-band='true'>
            <div className='akari-current-art'>{poster ? (p.canPreview ? <button type='button' className='akari-current-hero' data-akari-current-hero='true' aria-label='出力プレビューで再生' onClick={p.onPreview}>
                <img src={poster} alt='' onError={() => setFailedPosterSrc(poster)} /><span className='akari-current-play'>▶</span>
            </button> : <div className='akari-current-hero' data-akari-current-hero='true'><img src={poster} alt='' onError={() => setFailedPosterSrc(poster)} /></div>)
                : p.canPreview ? <button type='button' className='akari-current-hero akari-current-hero-empty akari-current-hero-preview-placeholder' data-akari-current-hero='true' data-akari-current-hero-preview-placeholder='true' aria-label='出力プレビューで再生' onClick={p.onPreview}>
                    <EmptyFilmIcon />
                    <span className='akari-current-play'>▶</span>
                </button> : <div className='akari-current-hero akari-current-hero-empty' data-akari-current-hero='true' data-akari-current-hero-empty='true'>
                    <EmptyFilmIcon />
                </div>}{p.frames.length > 0 && <div className='akari-current-thumbnails' data-akari-current-thumbnails='true'>{Array.from({ length: 5 }, (_, index) => <CurrentThumbnail key={index} src={p.frames[index]} index={index} />)}</div>}</div>
            <div className='akari-current-detail'>
                <div className='akari-current-crumb'>
                    <button type='button' className={`akari-current-tag ${p.channel ? 'channel' : 'single'}`} data-akari-channel-switch='true'
                        title={p.channel ? 'チャンネルを切り替える' : 'このプロジェクトをチャンネルに入れる'}
                        onClick={p.channel ? p.onSwitch : p.onJoin}>
                        <span className={`codicon ${p.channel ? 'codicon-layers' : 'codicon-circle-outline'}`} aria-hidden='true' />
                        {p.channel || '単体'}
                    </button>
                </div>
                <h2 className='akari-current-name'>{p.name}</h2>
                <button type='button' className='akari-current-path' title={`${p.path}（クリックでフォルダを開く）`} onClick={p.onReveal}>
                    <span className='codicon codicon-folder-opened' aria-hidden='true' />
                    <span className='p'>{p.path}</span>
                </button>
                {note}
                <div className='akari-current-stats' data-akari-current-stats='true'>{values.filter((entry): entry is [string, string] => !!entry[1]).map(([label, value]) => <div key={label} className='akari-current-stat' data-akari-stat={label}><span>{label}</span><b>{value}</b></div>)}</div>
            </div>
        </div>
    </section>;
}
