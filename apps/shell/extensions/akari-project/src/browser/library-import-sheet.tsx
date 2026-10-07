import * as React from '@theia/core/shared/react';
import { createPortal } from '@theia/core/shared/react-dom';
import URI from '@theia/core/lib/common/uri';
import { AkariProjectService, LibraryCheckFinding } from '../common/akari-project-protocol';
import { LibraryImportItem, LibraryImportPlan, LibraryImportResult, LIBRARY_IMPORT_KINDS, libraryImportGroups } from '../common/library-import';
import { hoverPopupPosition } from '../common/material-card-hover';
import { AssetSiteListing } from '../common/asset-sites';
import { composeSiteAgentPrompt } from '../common/asset-site-prompt';
import { AKARI_BORDER, AKARI_FAINT, AKARI_INK, AKARI_LINE, AKARI_RADIUS, AKARI_SURFACE } from '../common/akari-surface-tokens';

interface Props {
    service: AkariProjectService; isOSX: boolean;
    overlayHost: HTMLElement;
    request?: { paths: string[] };
    pick(mode: 'both' | 'files' | 'folders'): Promise<string[]>;
    imported(result: LibraryImportResult): Promise<void>;
    stopAudio(): void;
    consumed(): void;
    siteCategory?: string;
    openSite(id: string): Promise<void>;
    askSiteAgent(prompt: string): Promise<void>;
    openLab(): void;
    projectUri?: string;
    revealLibraryPath(path: string): void;
}
const css = `
.akari-import-menu { position:absolute; right:12px; bottom:108px; width:252px; box-sizing:border-box; padding:6px;
 background:${AKARI_SURFACE.raised}; border:1px solid ${AKARI_LINE.edge}; border-radius:calc(${AKARI_RADIUS.panel}px + 2px);
 box-shadow:0 12px 32px color-mix(in srgb, var(--akari-ground) 60%, transparent), 0 2px 6px color-mix(in srgb, var(--akari-ground) 40%, transparent); }
.akari-import-menu-item.theia-button { display:grid; grid-template-columns:28px minmax(0,1fr); gap:10px; align-items:center;
 width:100%; height:auto; min-height:44px; min-width:0 !important; margin:0 !important; padding:8px; text-align:left; white-space:normal; border:0; border-radius:${AKARI_RADIUS.panel}px; }
.akari-import-menu-item.plain { grid-template-columns:minmax(0,1fr); min-height:32px; padding:6px 8px; }
.akari-import-menu-icon { display:grid; place-items:center; width:28px; height:28px; border-radius:${AKARI_RADIUS.chip}px; background:${AKARI_SURFACE.elevated}; color:${AKARI_INK}; }
.akari-import-menu-title { display:block; font-size:12.5px; font-weight:600; line-height:1.35; color:${AKARI_INK}; }
.akari-import-menu-description { display:block; font-size:11px; line-height:1.4; color:var(--akari-muted); }
.akari-import-soon { margin-left:6px; padding:0 5px; border-radius:${AKARI_RADIUS.chip}px; background:${AKARI_SURFACE.elevated}; color:var(--akari-muted); font-size:10px; }
.akari-import-menu-separator { height:1px; background:${AKARI_LINE.hairline}; margin:6px 4px; }
.akari-import-backdrop { position:fixed; z-index:50; background:color-mix(in srgb, var(--akari-ground) 40%, transparent); display:flex; align-items:flex-end; }
.akari-import-sheet { height:88%; width:100%; box-sizing:border-box; display:flex; flex-direction:column; min-height:0;
 background:${AKARI_SURFACE.raised}; color:${AKARI_INK}; border:${AKARI_BORDER.edge}; border-bottom:0;
 border-radius:${AKARI_RADIUS.card}px ${AKARI_RADIUS.card}px 0 0; box-shadow:0 -10px 32px color-mix(in srgb, var(--akari-ground) 55%, transparent); animation:akari-import-rise .18s ease-out; }
.akari-import-sheet header { flex:none; display:flex; align-items:center; gap:8px; padding:12px 10px 10px 14px; }
.akari-import-title { flex:1; min-width:0; font-size:14px; font-weight:700; }
.akari-import-subtitle { display:block; font-size:11.5px; font-weight:400; color:var(--akari-muted); }
.akari-import-scroll { overflow:auto; min-height:0; flex:1; padding:4px 14px 14px; display:flex; flex-direction:column; gap:12px; }
.akari-import-sheet footer { flex:none; display:flex; justify-content:flex-end; gap:8px; padding:10px 14px; border-top:${AKARI_BORDER.hairline}; }
.akari-import-sheet .theia-button { min-width:0 !important; margin-left:0 !important; }
.akari-import-drop { border:1px dashed ${AKARI_LINE.edge}; border-radius:calc(${AKARI_RADIUS.panel}px + 2px); padding:28px 14px; display:grid; justify-items:center; gap:10px; text-align:center; color:var(--akari-muted); background:${AKARI_SURFACE.card}; font-size:12px; }
.akari-import-drop .codicon { font-size:26px; color:${AKARI_FAINT}; }
.akari-import-drop strong { color:${AKARI_INK}; font-size:13px; }
.akari-import-ok { display:flex; gap:6px; align-items:center; font-size:12px; color:var(--akari-success); }
.akari-import-group { background:${AKARI_SURFACE.card}; border-radius:calc(${AKARI_RADIUS.panel}px + 2px); overflow:hidden; }
.akari-import-group summary, .akari-import-group-heading { display:flex; align-items:center; gap:8px; padding:9px 10px; cursor:pointer; font-size:12.5px; font-weight:600; }
.akari-import-group-count { margin-left:auto; color:var(--akari-muted); font-size:11.5px; font-weight:400; font-variant-numeric:tabular-nums; }
.akari-import-row { display:flex; align-items:center; gap:8px; padding:6px 10px; border-top:${AKARI_BORDER.hairline}; font-size:12px; }
.akari-import-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.akari-import-duration { color:${AKARI_FAINT}; font-variant-numeric:tabular-nums; font-size:11.5px; }
.akari-import-row-ambiguous { flex-wrap:wrap; }
.akari-import-kind-question { width:100%; display:flex; align-items:center; gap:8px; color:var(--akari-muted); font-size:11.5px; }
.akari-library-import-add.theia-button { min-width:0 !important; margin-left:0 !important; padding:0 !important; }
.akari-import-sheet input[type=text], .akari-import-sheet textarea { box-sizing:border-box; width:100%; }
.akari-import-check { display:flex; align-items:center; gap:8px; font-size:12.5px; }
.akari-import-lab { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:10px; align-items:center; background:color-mix(in srgb, var(--akari-accent) 12%, ${AKARI_SURFACE.raised}); border-radius:calc(${AKARI_RADIUS.panel}px + 2px); padding:10px 12px; }
.akari-import-lab strong, .akari-import-lab span { display:block; }
.akari-import-lab span { font-size:11px; color:var(--akari-muted); }
.akari-import-ask { display:grid; gap:6px; }
.akari-import-ask label { font-size:11.5px; color:var(--akari-muted); }
.akari-import-ask textarea { min-height:44px; padding:7px 9px; border-radius:${AKARI_RADIUS.panel}px; background:${AKARI_SURFACE.card}; border:${AKARI_BORDER.hairline}; color:${AKARI_INK}; font:inherit; }
.akari-import-actions { display:flex; gap:6px; justify-content:flex-end; }
.akari-import-site { background:${AKARI_SURFACE.card}; border-radius:calc(${AKARI_RADIUS.panel}px + 2px); padding:10px 12px; display:grid; gap:6px; }
.akari-import-site-heading { display:flex; align-items:center; gap:8px; }
.akari-import-site-recs { margin-left:auto; color:var(--akari-muted); font-size:11px; }
.akari-import-free { padding:0 6px; border-radius:${AKARI_RADIUS.chip}px; color:var(--akari-success); background:color-mix(in srgb, var(--akari-success) 12%, transparent); font-size:10.5px; }
.akari-import-site p { margin:0; color:var(--akari-muted); font-size:11.5px; }
.akari-import-site .akari-import-actions { justify-content:flex-start; }
.akari-import-paid { background:${AKARI_SURFACE.card}; border-radius:calc(${AKARI_RADIUS.panel}px + 2px); padding:8px 10px; color:var(--akari-muted); font-size:12px; }
.akari-import-summary { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; }
.akari-import-summary div { background:${AKARI_SURFACE.card}; border-radius:${AKARI_RADIUS.panel}px; padding:8px 10px; font-size:11px; color:var(--akari-muted); }
.akari-import-summary b { display:block; font-size:17px; color:${AKARI_INK}; }
.akari-import-finding { display:grid; grid-template-columns:auto minmax(0,1fr); gap:8px; padding:8px 10px; border-top:${AKARI_BORDER.hairline}; font-size:12px; }
.akari-import-finding:first-child { border-top:0; }
.akari-import-level { padding:0 6px; border-radius:${AKARI_RADIUS.chip}px; font-size:10.5px; font-weight:700; }
.akari-import-level.error { color:var(--akari-danger); background:color-mix(in srgb, var(--akari-danger) 14%, transparent); }
.akari-import-level.warning { color:var(--akari-warning); background:color-mix(in srgb, var(--akari-warning) 12%, transparent); }
.akari-import-finding small { display:block; color:${AKARI_FAINT}; font-family:var(--akari-mono, monospace); }
.akari-import-finding-action { grid-column:2; }
@keyframes akari-import-rise { from { transform:translateY(100%); } to { transform:translateY(0); } }
@media (prefers-reduced-motion:reduce) { .akari-import-sheet { animation:none; } }
`;

export function libraryImportReadinessText(rejectedCount: number): string {
    return `✓ 全部読み込めることを確認しました${rejectedCount > 0 ? `（取り込まない ${rejectedCount} 件）` : ''}`;
}

export function focusLibraryImportSheet(element: HTMLElement | null): void {
    element?.focus({ preventScroll: true });
}

/** Stable React children keep details, scrollTop, focus and text selection across widget updates. */
export function LibraryImportSheet(props: Props): React.ReactElement {
    const [menu, setMenu] = React.useState(false);
    const [open, setOpen] = React.useState(false);
    const [sitesOpen, setSitesOpen] = React.useState(false);
    const [checkOpen, setCheckOpen] = React.useState(false);
    const [checkBusy, setCheckBusy] = React.useState(false);
    const [checkResult, setCheckResult] = React.useState<{ ok: number; warnings: LibraryCheckFinding[]; errors: LibraryCheckFinding[] }>();
    const [sites, setSites] = React.useState<AssetSiteListing[]>([]);
    const [siteTab, setSiteTab] = React.useState<'audio' | 'font' | 'visual'>('audio');
    const [siteRequest, setSiteRequest] = React.useState('');
    const [plan, setPlan] = React.useState<LibraryImportPlan>();
    const [busy, setBusy] = React.useState<'plan' | 'apply'>();
    const [error, setError] = React.useState('');
    const [asSet, setAsSet] = React.useState(false);
    const [title, setTitle] = React.useState('');
    const [credit, setCredit] = React.useState('');
    const [playing, setPlaying] = React.useState<string>();
    const [hover, setHover] = React.useState<{ item: LibraryImportItem; left: number; top: number }>();
    const [visual, setVisual] = React.useState<{ image?: string; error?: string }>({});
    const audio = React.useRef<HTMLAudioElement>();
    const generation = React.useRef(0);
    const playGeneration = React.useRef(0);
    const mounted = React.useRef(true);
    const waveforms = React.useRef(new Map<string, { image?: string; error?: string }>());
    const dialog = React.useRef<HTMLDivElement>(null);
    const addButton = React.useRef<HTMLButtonElement>(null);
    const menuElement = React.useRef<HTMLDivElement>(null);
    const sitesDialog = React.useRef<HTMLDivElement>(null);
    const checkDialog = React.useRef<HTMLDivElement>(null);
    const [bounds, setBounds] = React.useState(() => props.overlayHost.getBoundingClientRect());
    const sheetKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, dismiss: () => void): void => {
        if (event.key === 'Escape') { event.stopPropagation(); dismiss(); }
        if (event.key !== 'Tab') return;
        const elements = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), summary')).filter(element => element.getClientRects().length > 0);
        const first = elements[0], last = elements[elements.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    const hoverDelay = React.useRef<ReturnType<typeof setTimeout>>();
    const hideHover = (): void => { if (hoverDelay.current) clearTimeout(hoverDelay.current); hoverDelay.current = undefined; setHover(undefined); };
    const stop = (): void => {
        playGeneration.current++;
        if (audio.current) { audio.current.pause(); audio.current.removeAttribute('src'); audio.current.load(); }
        if (mounted.current) setPlaying(undefined);
    };
    const close = (): void => { if (busy === 'apply') return; generation.current++; stop(); hideHover(); setOpen(false); setBusy(undefined); };
    const showSites = (): void => {
        setMenu(false); setSitesOpen(true); setError('');
        setSiteTab(props.siteCategory?.includes('font') ? 'font' :
            props.siteCategory?.includes('still') || props.siteCategory?.includes('broll') ? 'visual' : 'audio');
        void props.service.getAssetSiteListings().then(setSites).catch(e => setError(String(e)));
    };
    React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; stop(); if (hoverDelay.current) clearTimeout(hoverDelay.current); }; }, []);
    React.useEffect(() => { if (menu) menuElement.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true }); }, [menu]);
    React.useEffect(() => {
        if (!open) return;
        const previous = document.activeElement as HTMLElement | null;
        focusLibraryImportSheet(dialog.current);
        return () => { if (previous?.isConnected) focusLibraryImportSheet(previous); };
    }, [open]);
    React.useEffect(() => {
        if (!sitesOpen && !checkOpen) return;
        const previous = document.activeElement as HTMLElement | null;
        focusLibraryImportSheet(sitesOpen ? sitesDialog.current : checkDialog.current);
        return () => { if (previous?.isConnected) focusLibraryImportSheet(previous); };
    }, [sitesOpen, checkOpen]);
    React.useLayoutEffect(() => {
        const measure = (): void => setBounds(props.overlayHost.getBoundingClientRect());
        measure();
        const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
        observer?.observe(props.overlayHost);
        window.addEventListener('resize', measure);
        return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
    }, [props.overlayHost]);
    const begin = async (paths: string[]): Promise<void> => {
        if (!paths.length || busy === 'apply') return;
        const current = ++generation.current;
        stop(); props.stopAudio(); hideHover(); waveforms.current.clear(); setMenu(false); setOpen(true);
        setPlan(undefined); setError(''); setAsSet(false); setTitle(''); setCredit(''); setBusy('plan');
        try { const value = await props.service.planLibraryImport(paths); if (current === generation.current) setPlan(value); }
        catch (e) { if (current === generation.current) setError(String(e)); }
        finally { if (current === generation.current) setBusy(undefined); }
    };
    React.useEffect(() => { if (props.request) { void begin(props.request.paths); props.consumed(); } }, [props.request]);
    const pick = async (mode: 'both' | 'files' | 'folders'): Promise<void> => {
        try { const paths = await props.pick(mode); if (mounted.current) await begin(paths); }
        catch (e) { setError(String(e)); }
    };
    React.useEffect(() => {
        if (!hover) { setVisual({}); return; }
        let alive = true;
        const item = hover.item;
        setVisual({});
        void (async () => {
            try {
                if (item.category === 'audio') {
                    let result = waveforms.current.get(item.path);
                    if (!result) { result = await props.service.previewLibraryImportAudio(item.path); waveforms.current.set(item.path, result); }
                    if (alive) setVisual(result);
                } else if (item.kind === 'still') {
                    const uri = URI.fromFilePath(item.path);
                    if (alive) setVisual({ image: uri.toString() });
                }
            } catch { if (alive) setVisual({ error: 'プレビューを表示できません' }); }
        })();
        const hide = (): void => setHover(undefined);
        window.addEventListener('scroll', hide, true); window.addEventListener('resize', hide);
        return () => { alive = false;
            window.removeEventListener('scroll', hide, true); window.removeEventListener('resize', hide); };
    }, [hover?.item.path]);
    const play = async (item: LibraryImportItem): Promise<void> => {
        const wasPlaying = playing === item.path;
        stop(); if (wasPlaying) return;
        props.stopAudio();
        const current = playGeneration.current;
        setPlaying(item.path); setError('');
        try {
            const uri = URI.fromFilePath(item.path);
            // Same file-URI route as the library's existing audio cards, including external sources.
            const player = audio.current ?? (audio.current = new Audio());
            player.onended = stop;
            player.onerror = () => { stop(); setError(`${item.name} を試聴できません`); };
            player.src = uri.toString();
            await player.play();
        } catch (e) { if (current === playGeneration.current) { stop(); setError(`試聴できません: ${String(e)}`); } }
    };
    const apply = async (): Promise<void> => {
        if (!plan || busy || (asSet && !title.trim())) return;
        stop(); hideHover(); setBusy('apply'); setError('');
        const value = { ...plan, credit: credit.trim() || undefined,
            pack: asSet ? { id: `own-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, title: title.trim() } : undefined };
        try {
            const result = await props.service.applyLibraryImport(value);
            // A partial apply is still an import; the callback reports failures and reloads the home.
            await props.imported(result);
            if (mounted.current) setOpen(false);
        } catch (e) { if (mounted.current) setError(String(e)); }
        finally { if (mounted.current) setBusy(undefined); }
    };
    const row = (item: LibraryImportItem): React.ReactNode => <div className={`akari-import-row${item.ambiguous ? ' akari-import-row-ambiguous' : ''}`} key={item.path}
        onMouseEnter={event => { const position = hoverPopupPosition(event.currentTarget.getBoundingClientRect(),
            { width: window.innerWidth, height: window.innerHeight }, { width: 300, height: 220 }); hideHover(); hoverDelay.current = setTimeout(() => setHover({ item, ...position }), 250); }}
        onMouseLeave={hideHover}>
        {item.category === 'audio' && <button type='button' className='theia-button secondary icon akari-import-audio' style={{ borderRadius: '50%' }} aria-label={`${item.name} を試聴`} aria-pressed={playing === item.path}
            onClick={() => void play(item)}>{playing === item.path ? '■' : '▶'}</button>}
        <span className='akari-import-name' title={item.path}>{item.name}</span>
        <small className='akari-import-duration'>{item.durationSec !== null ? `${item.durationSec.toFixed(1)} 秒` : `${((item.bytes ?? 0) / 1024).toFixed(0)} KB`}</small>
        {item.ambiguous && <span className='akari-import-kind-question'>どちらで入れる？<span role='group' aria-label={`${item.name} の種類`} className='akari-seg'>
            {(['sfx', 'bgm'] as const).map(kind => <button type='button' className='theia-button quiet small' key={kind} aria-pressed={item.kind === kind}
                disabled={busy === 'apply'} onClick={() => setPlan(previous => previous && ({ ...previous,
                    items: previous.items.map(entry => entry.path === item.path ? { ...entry, kind } : entry) }))}>{kind === 'sfx' ? '効果音' : 'BGM'}</button>)}
        </span></span>}
    </div>;
    const count = plan?.items.filter(item => item.selected !== false).length ?? 0;
    return createPortal(<div className='akari-library-import'>
        <style>{css}</style>
        <button ref={addButton} type='button' className='theia-button akari-library-import-add' aria-label='ライブラリに追加' aria-haspopup='menu' aria-expanded={menu}
            style={{ position: 'fixed', left: bounds.right - 58, top: bounds.bottom - 100, width: 42, height: 42, borderRadius: '50%', fontSize: 24, zIndex: 30 }}
            onClick={() => setMenu(!menu)}>＋</button>
        {menu && <div style={{ position: 'fixed', left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height, zIndex: 40 }} onClick={() => setMenu(false)}>
            <div ref={menuElement} role='menu' aria-label='ライブラリに追加' className='akari-import-menu'
                onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Escape') { setMenu(false); addButton.current?.focus({ preventScroll: true }); } }}>
                <button type='button' className='theia-button quiet akari-import-menu-item' role='menuitem' onClick={() => { setMenu(false); setPlan(undefined); setError(''); setOpen(true); }}>
                    <span className='akari-import-menu-icon codicon codicon-folder-opened' aria-hidden='true' /><span><span className='akari-import-menu-title'>ローカルから取り込む</span><span className='akari-import-menu-description'>{props.isOSX ? 'この Mac のファイルやフォルダ' : 'このパソコンのファイルやフォルダ'}</span></span></button>
                <button type='button' className='theia-button quiet akari-import-menu-item' role='menuitem' onClick={showSites}>
                    <span className='akari-import-menu-icon codicon codicon-globe' aria-hidden='true' /><span><span className='akari-import-menu-title'>素材サイトでさがす</span><span className='akari-import-menu-description'>Lab と、無料で使える配布サイト</span></span></button>
                <button type='button' className='theia-button quiet akari-import-menu-item' role='menuitem' disabled>
                    <span className='akari-import-menu-icon codicon codicon-link' aria-hidden='true' /><span><span className='akari-import-menu-title'>URL を貼って入れる<span className='akari-import-soon'>今後</span></span><span className='akari-import-menu-description'>配布ページの URL から取り込む</span></span></button>
                <div className='akari-import-menu-separator' role='separator' />
                <button type='button' className='theia-button quiet akari-import-menu-item plain' role='menuitem' onClick={() => { setMenu(false); props.overlayHost.dispatchEvent(new CustomEvent('akari.library.changeLocation')); }}><span className='akari-import-menu-title'>素材の置き場を変える…</span></button>
                <button type='button' className='theia-button quiet akari-import-menu-item plain' role='menuitem' onClick={() => { setMenu(false); setCheckOpen(true); setCheckBusy(true); setCheckResult(undefined); setError('');
                    void props.service.checkLibrary(props.projectUri).then(setCheckResult).catch(e => setError(String(e))).finally(() => setCheckBusy(false)); }}><span className='akari-import-menu-title'>ライブラリを点検</span></button>
            </div>
        </div>}
        {checkOpen && <div className='akari-import-backdrop' data-akari-library-check-sheet
            style={{ left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }}
            onMouseDown={event => { if (event.target === event.currentTarget) setCheckOpen(false); }}>
            <div ref={checkDialog} tabIndex={-1} role='dialog' aria-modal='true' aria-label='ライブラリを点検' className='akari-import-sheet' onKeyDown={event => sheetKeyDown(event, () => setCheckOpen(false))}>
                <header><span className='akari-import-title'>ライブラリを点検</span><button type='button' className='theia-button quiet small' onClick={() => setCheckOpen(false)}>閉じる</button></header>
                <div className='akari-import-scroll'>
                    {checkBusy && <p role='status'>点検しています…</p>}
                    {checkResult && <><div className='akari-import-summary'><div><b>{checkResult.ok}</b>問題なし</div><div><b>{checkResult.warnings.length}</b>注意</div><div><b>{checkResult.errors.length}</b>エラー</div></div>
                        <div className='akari-import-group'>{[...checkResult.errors, ...checkResult.warnings].map((finding, index) =>
                            <div className='akari-import-finding' key={`${finding.code}-${finding.category}-${finding.id}-${index}`}>
                                <span className={`akari-import-level ${finding.level === 'error' ? 'error' : 'warning'}`}>{finding.level === 'error' ? 'エラー' : '注意'}</span>
                                <span>{finding.message}<small>{finding.category}/{finding.id}</small></span>
                                {finding.level === 'error' && <span className='akari-import-finding-action'><button type='button' className='theia-button secondary small' onClick={() => props.revealLibraryPath(finding.dir)}>Finder で場所を見る</button></span>}
                            </div>)}</div></>}
                    {error && <p role='alert'>{error}</p>}
                </div>
            </div>
        </div>}
        {sitesOpen && <div className='akari-import-backdrop' data-akari-site-sheet
            style={{ left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }}
            onMouseDown={event => { if (event.target === event.currentTarget) setSitesOpen(false); }}>
            <div ref={sitesDialog} tabIndex={-1} role='dialog' aria-modal='true' aria-label='素材サイトでさがす' className='akari-import-sheet' onKeyDown={event => sheetKeyDown(event, () => setSitesOpen(false))}>
                <header><span className='akari-import-title'>素材サイトでさがす</span><button type='button' className='theia-button quiet small' onClick={() => setSitesOpen(false)}>閉じる</button></header>
                <div className='akari-import-scroll'>
                    <div className='akari-import-lab'><div><strong>AKARI Video Lab</strong><span>そのまま使える素材。まずここから</span></div><button type='button' className='theia-button small' onClick={() => { setSitesOpen(false); props.openLab(); }}>Lab を開く</button></div>
                    <div className='akari-import-ask'><label htmlFor='akari-site-request'>ほしいものを書いて、エージェントに探してもらう</label>
                        <textarea id='akari-site-request' placeholder='例: 料理動画に合う、明るくて短いジングル' value={siteRequest} onChange={event => setSiteRequest(event.target.value)} />
                        <div className='akari-import-actions'><button type='button' className='theia-button secondary small' onClick={() => { setSitesOpen(false); void props.askSiteAgent(composeSiteAgentPrompt(undefined, siteRequest)); }}>エージェントに頼む</button></div>
                    </div>
                    <div role='tablist' aria-label='素材サイトの種類' className='akari-seg' style={{ alignSelf: 'flex-start' }}>
                        {([['audio', '音'], ['font', 'フォント'], ['visual', '映像・画像']] as const).map(([key, label]) =>
                            <button key={key} type='button' className='theia-button quiet small' role='tab' aria-selected={siteTab === key} onClick={() => setSiteTab(key)}>{label}</button>)}
                    </div>
                    {sites.filter(value => value.site.tab === siteTab && value.site.price === 'free').map(value =>
                        <div className='akari-import-site' key={value.site.id}>
                            <div className='akari-import-site-heading'><strong>{value.site.name}</strong><span className='akari-import-free'>無料</span>{value.recommendations.length > 0 && <span className='akari-import-site-recs'>定番 {value.recommendations.length} 件</span>}</div>
                            <p>{value.site.terms.summary_ja}</p>
                            <div className='akari-import-actions'><button type='button' className='theia-button secondary small' onClick={() => { setSitesOpen(false); void props.openSite(value.site.id); }}>開く</button>
                                <button type='button' className='theia-button quiet small' onClick={() => { setSitesOpen(false); void props.askSiteAgent(composeSiteAgentPrompt(value.site, siteRequest)); }}>エージェントに頼む</button></div>
                        </div>)}
                    <details className='akari-import-paid'><summary>有料・サブスクのサービス（{sites.filter(value => value.site.tab === siteTab && value.site.price !== 'free').length}）</summary>
                        {sites.filter(value => value.site.tab === siteTab && value.site.price !== 'free').map(value =>
                            <div className='akari-import-row' key={value.site.id}><strong>{value.site.name}</strong>
                                <small>{value.site.price === 'subscription' ? 'サブスク' : '買い切り'}</small>
                                <small>{siteTab === 'audio' ? '音素材' : siteTab === 'font' ? 'フォント' : '映像・画像'}</small>
                                <span>{value.site.terms.summary_ja}</span>
                                <button type='button' className='theia-button secondary small' onClick={() => { setSitesOpen(false); void props.openSite(value.site.id); }}>開く</button>
                                <button type='button' className='theia-button quiet small' onClick={() => { setSitesOpen(false); void props.askSiteAgent(composeSiteAgentPrompt(value.site, siteRequest)); }}>エージェントに頼む</button></div>)}</details>
                    {error && <p role='alert'>{error}</p>}
                </div>
            </div>
        </div>}
        {open && <div className='akari-import-backdrop' data-akari-local-import-sheet style={{ left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }}
            onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
            <div ref={dialog} tabIndex={-1} role='dialog' aria-modal='true' aria-label='ローカルから取り込む' className='akari-import-sheet'
                onKeyDown={event => sheetKeyDown(event, close)}>
                <header><span className='akari-import-title'>{plan ? `${count} 個を取り込みます` : 'ローカルから取り込む'}{plan && <span className='akari-import-subtitle'>種類ごとに分けました。違っていたら直せます</span>}</span>
                    {!plan && <button type='button' className='theia-button quiet small' disabled={busy === 'apply'} onClick={close}>閉じる</button>}</header>
                <div className='akari-import-scroll'>
                    {busy === 'plan' && <p role='status'>ファイルを確認しています…</p>}
                    {!plan && !busy && <div className='akari-import-drop'><span className='codicon codicon-cloud-upload' aria-hidden='true' />
                        <strong>ここへファイルやフォルダを落とす</strong><span>音・画像・動画・フォントをまとめて入れられます</span>
                        {props.isOSX ? <button type='button' className='theia-button secondary' onClick={() => void pick('both')}>ファイル・フォルダを選ぶ</button>
                            : <div className='akari-import-actions'><button type='button' className='theia-button secondary' onClick={() => void pick('files')}>ファイルを選ぶ</button><button type='button' className='theia-button secondary' onClick={() => void pick('folders')}>フォルダを選ぶ</button></div>}
                    </div>}
                    {plan && <>
                        <div className='akari-import-ok'>{libraryImportReadinessText(plan.rejected.length)}</div>
                        {plan.truncated && <p role='alert'>一度に確認できる {plan.limit} 件まで表示しています。残りは分けて取り込んでください。</p>}
                        {plan.warnings.map((warning, index) => <p key={index} role='status'>{warning}</p>)}
                        {libraryImportGroups(plan).map(group => <details key={group.kind} className='akari-import-group'>
                            <summary><span>{group.icon} {group.label}</span><span className='akari-import-group-count'>{group.items.length} 件</span></summary>
                            {group.items.map(row)}
                        </details>)}
                        {plan.items.some(item => item.ambiguous) && <section className='akari-import-group' aria-label='迷ったもの'>
                            <div className='akari-import-group-heading'>迷ったもの<span className='akari-import-group-count'>{plan.items.filter(item => item.ambiguous).length} 件</span></div>
                            {plan.items.filter(item => item.ambiguous).map(row)}
                        </section>}
                        {!!plan.duplicates.length && <section><h4>もう入っています · {plan.duplicates.length} 件</h4>
                            {plan.duplicates.map((item, index) => <p key={`${item.path}-${index}`}>{item.name} → {item.title || item.id}</p>)}</section>}
                        {!!plan.rejected.length && <section><h4>取り込まない · {plan.rejected.length} 件</h4>
                            {plan.rejected.map((item, index) => <p key={`${item.path}-${index}`}>{item.name} — {item.reason}</p>)}</section>}
                        <label className='akari-import-check'><input type='checkbox' checked={asSet} disabled={busy === 'apply'} onChange={event => setAsSet(event.target.checked)} />ひとまとまりのセットにする</label>
                        {asSet && <input type='text' aria-label='セットの名前' placeholder='セットの名前' value={title} disabled={busy === 'apply'} onChange={event => setTitle(event.target.value)} />}
                        <details><summary>くわしく</summary><label>クレジット文面（任意）<textarea value={credit} disabled={busy === 'apply'} onChange={event => setCredit(event.target.value)} /></label></details>
                    </>}
                    {error && <p role='alert'>{error}</p>}
                </div>
                {plan && <footer><button type='button' className='theia-button quiet' disabled={busy === 'apply'} onClick={close}>閉じる</button>
                    <button type='button' className='theia-button' disabled={!!busy || !count || (asSet && !title.trim())} onClick={() => void apply()}>
                        {busy === 'apply' ? '取り込み中…' : `${count} 個を取り込む`}</button></footer>}
            </div>
        </div>}
        {hover && createPortal(<div role='tooltip' className='akari-import-hover' style={{ position: 'fixed', left: hover.left, top: hover.top,
            width: 300, height: 220, zIndex: 10000, pointerEvents: 'none', boxSizing: 'border-box', padding: 12, borderRadius: AKARI_RADIUS.panel,
            background: AKARI_SURFACE.raised, color: AKARI_INK, boxShadow: '0 4px 24px color-mix(in srgb, var(--akari-ground) 50%, transparent)', border: AKARI_BORDER.edge }}>
            <div style={{ height: 145, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {visual.image ? <img src={visual.image} alt={hover.item.name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                    : <span>{visual.error || (hover.item.category === 'audio' || hover.item.kind === 'still' ? '読み込み中…' : LIBRARY_IMPORT_KINDS.find(kind => kind.kind === hover.item.kind)?.label)}</span>}
            </div>
            <div className='akari-import-name'>{hover.item.name}</div>
            <small>{hover.item.durationSec === null ? (hover.item.durationSource === 'size' ? '尺は未取得・サイズで推定 · ' : '') : `${hover.item.durationSec.toFixed(1)} 秒 · `}
                {((hover.item.bytes ?? 0) / 1024).toFixed(0)} KB</small>
        </div>, document.body)}
    </div>, props.overlayHost);
}
