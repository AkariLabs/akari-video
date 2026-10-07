import * as React from '@theia/core/shared/react';
import { BrowserEngine } from '../common/browser-engines';
import { AKARI_SURFACE } from '../common/akari-surface-tokens';

interface Props {
    engines: readonly BrowserEngine[]; selected: string; query: string; address: string; pickMode: boolean;
    onSelect(id: string): void; onQuery(value: string): void; onSearch(): void; onPickMode(): void;
    onBack(): void; onForward(): void; onReload(): void; onClearHistory(): void;
}

export function BrowserSearchBar(props: Props): React.ReactElement {
    const [menu, setMenu] = React.useState(false);
    return <header data-akari-browser-search-bar style={{ padding: '8px 12px', borderBottom: '1px solid var(--theia-panel-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <button type='button' className='theia-button icon' aria-label='戻る' onClick={props.onBack}>←</button>
            <button type='button' className='theia-button icon' aria-label='進む' onClick={props.onForward}>→</button>
            <button type='button' className='theia-button icon' aria-label='再読み込み' onClick={props.onReload}>↻</button>
            <div className='akari-seg' role='tablist' aria-label='検索サイト' style={{ display: 'flex', flexWrap: 'wrap' }}>
                {props.engines.map(engine => <button key={engine.id} type='button' role='tab' className='theia-button quiet'
                    aria-selected={props.selected === engine.id}
                    style={{ background: props.selected === engine.id ? AKARI_SURFACE.elevated : undefined,
                        borderBottom: props.selected === engine.id ? '2px solid var(--akari-accent)' : undefined }}
                    onClick={() => props.onSelect(engine.id)}>{engine.label}</button>)}
            </div>
            <input aria-label='検索語' value={props.query} onChange={event => props.onQuery(event.currentTarget.value)}
                onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) props.onSearch(); }}
                style={{ flex: '1 1 180px', minWidth: 120 }} />
            <button type='button' className='theia-button' onClick={props.onSearch}>検索</button>
            <button type='button' className='theia-button secondary' aria-pressed={props.pickMode}
                data-akari-browser-pick-mode={props.pickMode ? 'on' : 'off'} onClick={props.onPickMode}>選ぶモード</button>
            <div style={{ position: 'relative' }}>
                <button type='button' className='theia-button icon' aria-label='ブラウザの操作' aria-expanded={menu}
                    onClick={() => setMenu(value => !value)}>…</button>
                {menu && <div data-akari-browser-menu role='menu' style={{ position: 'absolute', right: 0, zIndex: 1,
                    background: AKARI_SURFACE.raised, border: '1px solid var(--akari-line)' }}>
                    <button type='button' role='menuitem' className='theia-button quiet' onClick={() => {
                        setMenu(false); props.onClearHistory();
                    }}>ブラウザの記録を消す</button>
                </div>}
            </div>
        </div>
        <output data-akari-site-address style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis',
            whiteSpace: 'nowrap' }}>{props.address}</output>
    </header>;
}
