import * as React from '@theia/core/shared/react';
import { AKARI_BORDER, AKARI_INK, AKARI_RADIUS, AKARI_SURFACE } from '../common/akari-surface-tokens';

const GRID = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '7px', padding: '8px 10px 12px' } as const;

export function LibraryTextTelopPage(props: { onBack(): void; onPlace(): void; tab: 'style' | 'font' | 'telop';
    onTabChange(tab: 'style' | 'font' | 'telop'): void; styles: React.ReactNode; myStyles: React.ReactNode;
    motions: React.ReactNode; fonts: React.ReactNode; telops: React.ReactNode }): React.ReactElement {
    return <div data-akari-library-text-look-page data-akari-library-text-tab={props.tab} style={{ minHeight: '100%' }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 6, padding: '8px 10px 9px', background: AKARI_SURFACE.card,
            borderBottom: AKARI_BORDER.hairline, boxShadow: '0 8px 14px -12px var(--theia-widget-shadow)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                <button type='button' data-akari-library-back onClick={props.onBack}
                    style={{ padding: 0, border: 'none', background: 'transparent', color: 'var(--theia-textLink-foreground)',
                        cursor: 'pointer', fontSize: '0.8em' }}>← ライブラリ</button>
                <strong style={{ fontSize: '0.86em' }}>テキスト</strong>
            </div>
            <button type='button' data-akari-library-place-text onClick={props.onPlace}
                style={{ width: '100%', margin: '10px 0 9px', padding: '7px 8px', cursor: 'pointer',
                    borderRadius: `${AKARI_RADIUS.panel}px`, border: AKARI_BORDER.ghost,
                    background: AKARI_SURFACE.raised, color: AKARI_INK, textAlign: 'left', fontWeight: 700 }}>
                ＋ 文字を置く
            </button>
            <div role='tablist' aria-label='テキストの種類' data-akari-caption-panel-switch={props.tab}
                style={{ position: 'relative', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', padding: '3px',
                    borderRadius: '8px', background: AKARI_SURFACE.elevated, border: AKARI_BORDER.edge }}>
                <span aria-hidden='true' style={{ position: 'absolute', top: '3px', bottom: '3px', left: '3px',
                    width: 'calc(33.333% - 2px)', borderRadius: '6px', background: AKARI_SURFACE.raised,
                    boxShadow: '0 1px 4px #0004', transform: props.tab === 'font' ? 'translateX(100%)' : props.tab === 'telop' ? 'translateX(200%)' : undefined,
                    transition: 'transform .18s ease' }} />
                {(['style', 'font', 'telop'] as const).map(tab => <button key={tab} type='button' role='tab'
                    data-akari-library-text-switch={tab} aria-selected={props.tab === tab}
                    onClick={() => props.onTabChange(tab)}
                    style={{ position: 'relative', border: 0, background: 'transparent', padding: '7px 4px',
                        color: props.tab === tab ? 'var(--akari-accent)' : AKARI_INK,
                        fontWeight: props.tab === tab ? 700 : 400, cursor: 'pointer', fontSize: '12px' }}>
                    {tab === 'style' ? 'スタイル' : tab === 'font' ? 'フォント' : 'テロップ'}
                </button>)}
            </div>
        </div>
        {props.tab === 'style' ? <div role='tabpanel' data-akari-text-look-section='style'>
            <ShelfHeading label='テキストスタイル' hint='置く / かける' />
            <div style={GRID}>{props.styles}</div>
            {props.myStyles}
            <ShelfHeading label='テキストアニメ' hint='かける・ホバーで再生' />
            <div style={GRID}>{props.motions}</div>
        </div> : props.tab === 'font' ? <div role='tabpanel' data-akari-text-look-section='font'>
            <ShelfHeading label='フォント' hint='置く / かける' />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', padding: '8px 10px 12px' }}>{props.fonts}</div>
        </div> : <div role='tabpanel' data-akari-text-look-section='telop'>
            <ShelfHeading label='テロップ' hint='置く / ドラッグ' />
            <div style={GRID}>{props.telops}</div>
        </div>}
    </div>;
}

function ShelfHeading(props: { label: string; hint: string }): React.ReactElement {
    return <div style={{ padding: '8px 10px 5px', background: AKARI_SURFACE.card,
        borderBottom: AKARI_BORDER.hairline, fontSize: '0.76em', fontWeight: 700 }}>
        {props.label} <small style={{ fontWeight: 400, opacity: 0.65 }}>— {props.hint}</small>
    </div>;
}
