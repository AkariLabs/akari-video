import * as React from '@theia/core/shared/react';
import { createPortal } from '@theia/core/shared/react-dom';
import { BrowserEngine } from '../common/browser-engines';
import { AKARI_BORDER, AKARI_INK, AKARI_RADIUS, AKARI_SURFACE } from '../common/akari-surface-tokens';

interface Props {
    engines: readonly BrowserEngine[]; selected: string; query: string; address: string; loading: boolean;
    hasView: boolean; pickMode: boolean; onPickMode(on: boolean): void;
    onSelect(id: string): void; onQuery(value: string): void; onSearch(): void;
    onBack(): void; onForward(): void; onReload(): void; onClearHistory(): void;
}

const css = `
[data-akari-browser-search-bar] { position:relative; isolation:isolate; box-sizing:border-box; padding:8px 12px 0; border-bottom:${AKARI_BORDER.hairline}; color:${AKARI_INK}; }
[data-akari-browser-search-bar] .akari-browser-main { display:flex; align-items:center; gap:4px; min-width:0; }
[data-akari-browser-search-bar] .akari-browser-engines { display:flex; flex:none; align-items:center; min-width:0; }
[data-akari-browser-search-bar] .akari-browser-engines button { white-space:nowrap; }
[data-akari-browser-search-bar] .akari-browser-engines > button { max-width:100px; padding-inline:7px; overflow:hidden; text-overflow:ellipsis; }
[data-akari-browser-search-bar][data-narrow="true"] .akari-browser-engines > button { max-width:84px; }
[data-akari-browser-search-bar] .akari-browser-engines > button[aria-pressed="true"] { border-color:var(--akari-accent) !important; }
[data-akari-browser-search-bar] .akari-browser-query { box-sizing:border-box; flex:1 1 auto; min-width:0; width:0; height:34px;
 padding:0 8px; border:1px solid var(--akari-button-secondary-line); border-radius:${AKARI_RADIUS.panel}px;
 background:${AKARI_SURFACE.card}; color:${AKARI_INK}; font:inherit; outline:none; }
[data-akari-browser-search-bar] .akari-browser-query:focus { border-color:var(--akari-accent); }
[data-akari-browser-search-bar] .akari-browser-query::placeholder { color:var(--akari-faint); }
[data-akari-browser-search-bar] .akari-browser-main > button { flex:none; white-space:nowrap; padding-inline:8px; }
[data-akari-browser-search-bar] .akari-browser-meta { display:flex; align-items:center; gap:3px; min-width:0; height:30px; }
[data-akari-browser-search-bar] .akari-browser-host { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis;
 white-space:nowrap; padding-left:8px; color:var(--akari-muted); font-size:11px; }
[data-akari-browser-menu].akari-browser-popup { position:absolute; box-sizing:border-box; width:220px; max-height:220px;
 overflow-x:hidden; overflow-y:auto; padding:6px; border:${AKARI_BORDER.edge}; border-radius:${AKARI_RADIUS.panel}px;
 background:${AKARI_SURFACE.raised}; color:${AKARI_INK}; }
[data-akari-browser-menu].akari-browser-popup button { box-sizing:border-box; display:flex; align-items:center; gap:8px;
 width:100%; height:36px; margin:0 0 4px; padding:0 9px; text-align:left; white-space:nowrap;
 border-radius:${AKARI_RADIUS.chip}px; overflow:hidden; }
[data-akari-browser-menu].akari-browser-popup button:last-child { margin-bottom:0; }
[data-akari-browser-menu].akari-browser-popup .akari-browser-menu-label { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; }
[data-akari-browser-menu].akari-browser-popup button[aria-checked="true"] { border-color:var(--akari-accent) !important; }
[data-akari-browser-search-bar] .akari-browser-progress { height:2px; overflow:hidden; }
[data-akari-browser-search-bar] .akari-browser-progress::after { content:''; display:block; width:35%; height:100%;
 background:var(--akari-accent); animation:akari-browser-loading 1.1s ease-in-out infinite alternate; }
@keyframes akari-browser-loading { from { transform:translateX(-100%); } to { transform:translateX(290%); } }
@media (prefers-reduced-motion:reduce) { [data-akari-browser-search-bar] .akari-browser-progress::after { animation:none; width:100%; } }
`;

function hostName(address: string): string {
    if (!address) return '';
    try { return new URL(address).hostname; } catch { return ''; }
}

export function BrowserSearchBar(props: Props): React.ReactElement {
    const ref = React.useRef<HTMLElement>(null);
    const [width, setWidth] = React.useState(0);
    const [engineMenu, setEngineMenu] = React.useState(false);
    const [moreMenu, setMoreMenu] = React.useState(false);
    const [menuBox, setMenuBox] = React.useState({ left: 0, right: 0, top: 0 });
    const updateMenuBox = React.useCallback(() => {
        const box = ref.current?.getBoundingClientRect();
        if (box) setMenuBox({ left: box.left + window.scrollX + 12, right: box.right + window.scrollX - 12,
            top: box.bottom + window.scrollY });
    }, []);
    React.useEffect(() => {
        if (!ref.current) return;
        const observer = new ResizeObserver(entries => { setWidth(entries[0].contentRect.width); updateMenuBox(); });
        observer.observe(ref.current);
        return () => observer.disconnect();
    }, [updateMenuBox]);
    React.useEffect(() => {
        if (!engineMenu && !moreMenu) return;
        updateMenuBox();
        window.addEventListener('resize', updateMenuBox);
        window.addEventListener('scroll', updateMenuBox, true);
        return () => { window.removeEventListener('resize', updateMenuBox);
            window.removeEventListener('scroll', updateMenuBox, true); };
    }, [engineMenu, moreMenu, updateMenuBox]);
    const collapsed = width > 0 && width <= 560;
    const visibleCount = collapsed ? 0 : Math.max(1, Math.min(props.engines.length, Math.floor((width - 300) / 105)));
    const visible = props.engines.slice(0, visibleCount);
    const hidden = props.engines.slice(visibleCount);
    const selectedHidden = hidden.find(engine => engine.id === props.selected);
    const selectedLabel = props.engines.find(engine => engine.id === props.selected)?.label ?? '検索サイト';
    const buttonLabel = width > 0 && width <= 480 ? selectedLabel.replace(/\s*画像$/, '') : selectedLabel;
    return <header ref={ref} data-akari-browser-search-bar data-narrow={width > 0 && width <= 480 ? 'true' : 'false'}>
        <style>{css}</style>
        <div className='akari-browser-main'>
            <div className='akari-browser-engines'>
                {visible.length > 0 && <div className='akari-seg' role='group' aria-label='検索サイト'>
                    {visible.map(engine => <button key={engine.id} type='button' className='theia-button quiet'
                        aria-label={engine.label} aria-pressed={props.selected === engine.id}
                        onClick={() => props.onSelect(engine.id)}>{engine.label}</button>)}
                </div>}
                {hidden.length > 0 && <button type='button' className='theia-button secondary small'
                    aria-label={`検索サイトを選ぶ: ${selectedLabel}`} title={selectedLabel}
                    aria-haspopup='menu' aria-expanded={engineMenu} aria-pressed={Boolean(selectedHidden)}
                    onClick={() => { updateMenuBox(); setMoreMenu(false); setEngineMenu(value => !value); }}>{collapsed ? buttonLabel : 'ほか'} ▾</button>}
            </div>
            <input className='akari-browser-query' aria-label='検索語' placeholder='調べたいもの' value={props.query}
                onChange={event => props.onQuery(event.currentTarget.value)}
                onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) props.onSearch(); }} />
            <button type='button' className='theia-button' aria-label='検索' onClick={props.onSearch}>検索</button>
            <button type='button' className={`theia-button ${props.pickMode ? '' : 'secondary'}`} aria-label='選ぶ'
                aria-pressed={props.pickMode} disabled={!props.hasView} title={!props.hasView ? '検索してから使えます' : undefined}
                data-akari-browser-pick-mode={props.pickMode ? 'on' : 'off'}
                onClick={() => props.onPickMode(!props.pickMode)}>選ぶ</button>
        </div>
        {props.pickMode && <div style={{ padding: '3px 8px', color: 'var(--akari-muted)', fontSize: 11 }}>
            画像をクリックすると取り込みます（大きく開いてから選ぶと原寸に近づきます）
        </div>}
        {engineMenu && hidden.length > 0 && createPortal(<div data-akari-browser-menu className='akari-browser-popup'
            role='menu' aria-label='検索サイト' style={{ left: menuBox.left, top: menuBox.top }}>
            {(collapsed ? props.engines : hidden).map(engine => <button key={engine.id} type='button'
                role='menuitemradio' aria-checked={props.selected === engine.id} className='theia-button secondary'
                onClick={() => { props.onSelect(engine.id); setEngineMenu(false); }}>
                <span className='akari-browser-menu-label'>{engine.label}</span>
                {props.selected === engine.id && <span className='codicon codicon-check' aria-hidden='true' />}
            </button>)}
        </div>, document.body)}
        <div className='akari-browser-meta'>
            <button type='button' className='theia-button icon quiet small' aria-label='戻る' onClick={props.onBack}><span className='codicon codicon-arrow-left' aria-hidden='true' /></button>
            <button type='button' className='theia-button icon quiet small' aria-label='進む' onClick={props.onForward}><span className='codicon codicon-arrow-right' aria-hidden='true' /></button>
            <button type='button' className='theia-button icon quiet small' aria-label='読み込み直し' onClick={props.onReload}><span className='codicon codicon-refresh' aria-hidden='true' /></button>
            <output data-akari-site-address className='akari-browser-host' title={props.address}>{hostName(props.address)}</output>
            <button type='button' className='theia-button icon quiet small' aria-label='ブラウザの操作' aria-haspopup='menu'
                aria-expanded={moreMenu} onClick={() => { updateMenuBox(); setEngineMenu(false); setMoreMenu(value => !value); }}>…</button>
        </div>
        {moreMenu && createPortal(<div data-akari-browser-menu className='akari-browser-popup' role='menu'
            style={{ left: Math.max(8, menuBox.right - 220), top: menuBox.top }}>
            <button type='button' role='menuitem' className='theia-button quiet' onClick={() => {
                setMoreMenu(false); props.onClearHistory();
            }}>ブラウザの記録を消す</button>
        </div>, document.body)}
        {props.loading && <div className='akari-browser-progress' role='progressbar' aria-label='ページを読み込み中' />}
    </header>;
}
