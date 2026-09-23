import * as React from '@theia/core/shared/react';
import * as ReactDOM from '@theia/core/shared/react-dom';
import { HomeStats } from './home-model';

export const homePanelCss = `
.akari-current-label{font-size:11px;font-weight:600;line-height:1.3;color:var(--theia-descriptionForeground);margin:0 0 8px}
.akari-current-band{background:var(--theia-sideBar-background);border:1px solid var(--theia-widget-border);border-radius:12px;padding:16px;display:grid;grid-template-columns:minmax(190px,32%) minmax(0,1fr);gap:18px;margin-bottom:20px}
.akari-current-band:has(.akari-current-hero-empty)>div{min-width:0}
.akari-current-hero{display:block;position:relative;width:100%;aspect-ratio:16/9;border:0;border-radius:8px;overflow:hidden;background:var(--theia-editor-background);cursor:pointer;padding:0;color:var(--theia-foreground)}
.akari-current-hero-empty{min-height:180px;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;padding:14px 10px;text-align:center;cursor:default;background:linear-gradient(145deg,color-mix(in srgb,var(--theia-sideBar-background) 94%,var(--akari-accent,var(--theia-focusBorder)) 6%),var(--theia-list-hoverBackground));border:1px solid var(--theia-widget-border)}
.akari-current-empty-icon{width:30px;height:30px;color:var(--akari-accent,var(--theia-focusBorder));opacity:.75}
.akari-current-empty-title{font-size:13px;font-weight:600}.akari-current-empty-hint{max-width:100%;font-size:11px;text-wrap:balance;color:var(--theia-descriptionForeground)}
.akari-current-hero-preview-placeholder{justify-content:space-between;cursor:pointer}
.akari-current-hero-preview-placeholder:hover{border-color:var(--akari-accent,var(--theia-focusBorder))}
.akari-current-empty-action{margin-top:2px;padding:5px 10px;border-radius:6px;border:1px solid color-mix(in srgb,var(--akari-accent,var(--theia-focusBorder)) 50%,transparent);background:color-mix(in srgb,var(--akari-accent,var(--theia-focusBorder)) 12%,transparent);color:var(--theia-foreground);font:inherit;font-size:11px;cursor:pointer}
.akari-current-empty-action:hover{border-color:var(--akari-accent,var(--theia-focusBorder));background:color-mix(in srgb,var(--akari-accent,var(--theia-focusBorder)) 20%,transparent)}
.akari-current-hero img,.akari-current-thumbnails img{width:100%;height:100%;object-fit:contain}
.akari-current-play{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);border-radius:100%;background:rgba(0,0,0,.65);color:white;padding:12px;font-size:17px}
.akari-current-thumbnails{display:flex;gap:5px;margin-top:6px}.akari-current-thumbnails img{width:calc((100% - 20px)/5);aspect-ratio:16/9;border-radius:4px;background:var(--theia-editor-background);object-fit:cover}
.akari-current-thumbnail-empty{box-sizing:border-box;width:calc((100% - 20px)/5);aspect-ratio:16/9;border-radius:4px;border:1px solid var(--theia-widget-border);background:color-mix(in srgb,var(--theia-sideBar-background) 80%,var(--theia-list-hoverBackground) 20%)}
.akari-current-crumb{display:flex;align-items:center;gap:8px}.akari-current-tag{display:inline-flex;align-items:center;gap:5px;padding:4px 9px;border-radius:99px;background:var(--theia-list-hoverBackground);font-size:11px;color:var(--theia-foreground);white-space:nowrap}.akari-current-tag.channel{color:var(--theia-focusBorder);background:color-mix(in srgb,var(--theia-focusBorder) 12%,transparent);border:1px solid color-mix(in srgb,var(--theia-focusBorder) 42%,transparent)}
.akari-current-switch{font-size:11px;padding:4px 8px;min-height:auto;height:auto;white-space:nowrap}.akari-current-name{font-size:20px;margin:7px 0 3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.akari-current-path{border:0;background:none;color:var(--theia-descriptionForeground);font:inherit;font-size:11px;text-align:left;padding:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;max-width:100%}
.akari-current-stats{display:flex;flex-wrap:wrap;gap:8px 20px;margin:18px 0 0}.akari-current-stat{display:flex;flex-direction:column;gap:3px;min-width:56px}.akari-current-stat span{color:var(--theia-descriptionForeground);font-size:11px}.akari-current-stat b{font-size:14px}
.akari-current-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:auto;padding-top:14px}.akari-current-actions button{font-size:12px;min-height:auto;height:auto;padding:6px 11px}
.akari-home-project-toolbar{display:flex;align-items:center;flex-wrap:nowrap;gap:7px;margin:12px 0;overflow-x:auto;overflow-y:hidden;padding-bottom:4px}.akari-home-project-toolbar h3{font-size:15px;margin:0 4px 0 0;flex:0 1 185px;min-width:112px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.akari-home-project-toolbar>*{flex-shrink:0}.akari-home-project-toolbar .akari-home-toolbar-button{display:inline-flex;align-items:center;justify-content:center;gap:4px;flex:0 0 auto;width:auto;min-height:28px;height:28px;margin:0;padding:4px 9px;font-size:11px;white-space:nowrap;line-height:1}.akari-home-project-toolbar .akari-home-toolbar-button .codicon{font-size:12px}.akari-home-project-toolbar select{flex:0 0 auto}.akari-home-project-toolbar input{flex-shrink:0}
.akari-home-sheet-scrim{position:fixed;inset:0;background:rgba(0,0,0,.58);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}
.akari-home-sheet{position:relative;background:var(--theia-sideBar-background);color:var(--theia-foreground);border:1px solid var(--theia-widget-border);box-shadow:0 20px 55px rgba(0,0,0,.35);border-radius:13px;padding:26px;width:min(620px,95vw);max-height:90vh;overflow:auto;box-sizing:border-box}
.akari-home-sheet-scrim[data-akari-home-dialog=channel-switch] .akari-home-sheet,.akari-home-sheet-scrim[data-akari-home-dialog=channel-choice] .akari-home-sheet,.akari-home-sheet-scrim[data-akari-home-dialog=channel-window-choice] .akari-home-sheet,.akari-home-sheet-scrim[data-akari-home-dialog=channel-create] .akari-home-sheet{width:min(360px,95vw);padding:18px}
.akari-home-sheet h3{font-size:18px;margin:0 32px 8px 0}.akari-home-sheet p{color:var(--theia-descriptionForeground);font-size:12px;line-height:1.6;margin:0 0 16px}.akari-home-sheet-close{position:absolute;right:10px;top:10px;border:0;background:none;color:var(--theia-foreground);font-size:20px;cursor:pointer}
.akari-home-start-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}.akari-home-start-card{display:flex;align-items:center;gap:11px;text-align:left;background:var(--theia-editor-background);border:1px solid var(--theia-widget-border);border-radius:9px;padding:13px;color:var(--theia-foreground);cursor:pointer;min-height:74px}.akari-home-start-card:hover:not(:disabled){border-color:var(--theia-focusBorder)}.akari-home-start-card:disabled{opacity:.55;cursor:default}.akari-home-start-card[data-trial-unavailable=true]{opacity:.55;cursor:help}.akari-home-start-card .codicon{font-size:22px;color:var(--theia-focusBorder)}.akari-home-start-card b,.akari-home-start-card small{display:block}.akari-home-start-card small{color:var(--theia-descriptionForeground);margin-top:4px}.akari-home-start-card em{margin-left:auto;font-style:normal;font-size:10px;border:1px solid var(--theia-widget-border);border-radius:99px;padding:2px 6px}.akari-home-sheet p.akari-home-voice-requirement{margin:10px 0 0;color:var(--theia-focusBorder);font-size:11px}
.akari-home-choice{display:block;text-align:left;width:100%;border:1px solid var(--theia-widget-border);border-radius:8px;background:var(--theia-editor-background);color:var(--theia-foreground);padding:12px;margin:8px 0;cursor:pointer}.akari-home-choice[data-selected=true]{border-color:var(--theia-focusBorder)}.akari-home-choice small{display:block;color:var(--theia-descriptionForeground);margin-top:4px}.akari-home-dialog-path{background:var(--theia-editor-background);padding:8px;border-radius:6px;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.akari-home-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:15px}
.akari-home-channel-list{display:grid;gap:3px}.akari-home-channel-row{display:flex;align-items:center;gap:10px;border:0;background:transparent;color:var(--theia-foreground);padding:9px;text-align:left;cursor:pointer;border-radius:7px}.akari-home-channel-row:hover{background:var(--theia-list-hoverBackground)}.akari-home-channel-row small{display:block;color:var(--theia-descriptionForeground)}.akari-home-channel-separator{height:1px;background:var(--theia-widget-border);margin:6px 0}.akari-home-channel-name-label{display:grid;gap:7px;font-size:12px}.akari-home-channel-name{width:100%;box-sizing:border-box}.akari-home-sheet p.akari-home-channel-error{color:var(--theia-errorForeground);margin:10px 0 0}
@container (max-width:650px){.akari-current-band{grid-template-columns:1fr}.akari-home-start-grid{grid-template-columns:1fr}}
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
    onPreview: () => void; onStart: () => void; onReveal: () => void; onEdit: () => void; onExport: () => void; onSwitch: () => void; onJoin: () => void; onLauncher: () => void;
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
    return <section className='akari-current-project' data-akari-current-location='true' data-akari-status-kind={p.channel ? 'inside' : 'outside'}>
        <p className='akari-current-label'>いま開いているプロジェクト</p>
        <div className='akari-current-band' data-akari-current-band='true'>
            <div>{poster ? (p.canPreview ? <button type='button' className='akari-current-hero' data-akari-current-hero='true' aria-label='出力プレビューで再生' onClick={p.onPreview}>
                <img src={poster} alt='' onError={() => setFailedPosterSrc(poster)} /><span className='akari-current-play'>▶</span>
            </button> : <div className='akari-current-hero' data-akari-current-hero='true'><img src={poster} alt='' onError={() => setFailedPosterSrc(poster)} /></div>)
                : p.canPreview ? <button type='button' className='akari-current-hero akari-current-hero-empty akari-current-hero-preview-placeholder' data-akari-current-hero='true' data-akari-current-hero-preview-placeholder='true' aria-label='出力プレビューで再生' onClick={p.onPreview}>
                    <EmptyFilmIcon />
                    <span className='akari-current-play'>▶</span>
                    <span className='akari-current-empty-title'>サムネイルはありません</span>
                </button> : <div className='akari-current-hero akari-current-hero-empty' data-akari-current-hero='true' data-akari-current-hero-empty='true'>
                    <EmptyFilmIcon />
                    <span className='akari-current-empty-title'>まだ映像がありません</span>
                    <button type='button' className='akari-current-empty-action' onClick={p.onStart}>素材を入れて始める</button>
                    <span className='akari-current-empty-hint'>素材をドラッグしても取り込めます</span>
                </div>}{p.frames.length > 0 && <div className='akari-current-thumbnails' data-akari-current-thumbnails='true'>{Array.from({ length: 5 }, (_, index) => <CurrentThumbnail key={index} src={p.frames[index]} index={index} />)}</div>}</div>
            <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}><div className='akari-current-crumb'><span className={`akari-current-tag ${p.channel ? 'channel' : 'single'}`}>{p.channel && <span className='codicon codicon-layers' aria-hidden='true' />}{p.channel || '単体'}</span><button type='button' className='theia-button secondary akari-current-switch' data-akari-channel-switch='true' onClick={p.channel ? p.onSwitch : p.onJoin}>{p.channel ? '切り替え' : 'チャンネルに入れる'}</button></div>
                <h2 className='akari-current-name'>{p.name}</h2><button type='button' className='akari-current-path' title={p.path} onClick={p.onReveal}>▱ {p.path}</button>
                <div className='akari-current-stats' data-akari-current-stats='true'>{values.filter((entry): entry is [string, string] => !!entry[1]).map(([label, value]) => <div key={label} className='akari-current-stat' data-akari-stat={label}><span>{label}</span><b>{value}</b></div>)}</div>
                <div className='akari-current-actions'><button type='button' className='theia-button main' onClick={p.onEdit}>続きから編集</button><button type='button' className='theia-button secondary' onClick={p.onReveal}>Finder で表示</button><button type='button' className='theia-button secondary' onClick={p.onExport}>書き出し</button><button type='button' className='theia-button secondary' onClick={p.onLauncher}>プロジェクト・ランチャー</button></div>
            </div>
        </div>
    </section>;
}
