import * as React from '@theia/core/shared/react';
import { AKARI_BORDER, AKARI_INK, AKARI_RADIUS, AKARI_SURFACE } from '../common/akari-surface-tokens';
import { libraryFontLabel } from '../common/library-font-label';
import { fontPreviewPath } from '../common/library-shelf-visuals';
import type { AssetCatalogViewItem } from '../common/akari-project-protocol';
import { LibraryDotsButton } from './library-card-view';
import type { FontShelfCard } from './library-shelf-visuals-view';

const GRID = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '7px', padding: '8px 10px 12px' } as const;

export type LibraryTextTab = 'style' | 'font';

/** The visual changes here; actions are taken from the existing FontShelfCard element. */
export function LibraryTextFontRow(props: { item: AssetCatalogViewItem; faceFamily?: string;
    card: React.ReactElement<React.ComponentProps<typeof FontShelfCard>> }): React.ReactElement {
    const { item, faceFamily } = props;
    const card = props.card.props;
    const label = libraryFontLabel(item.id, item.title);
    const name = <span style={{ flex: '1 1 auto', minWidth: 0 }}>
        <span data-akari-font-name style={{ display: 'block', fontFamily: faceFamily ? `${JSON.stringify(faceFamily)}, sans-serif` : undefined,
            fontSize: faceFamily ? '19px' : '13px', lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden',
            textOverflow: 'ellipsis' }}>{label.display}</span>
        {label.english && <small data-akari-font-english style={{ display: 'block', fontSize: '10px', opacity: 0.65,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label.english}</small>}
    </span>;
    const actions = <span style={{ display: 'flex', alignItems: 'center', gap: '5px', flex: '0 0 auto' }}>
        {card.favorite && <span className='codicon codicon-star-full' aria-label='お気に入り' />}
        <LibraryDotsButton variant='inline' label={item.title} onOpen={card.onInfo} />
    </span>;
    return <div role='button' tabIndex={0} draggable data-akari-library-card='list'
        data-akari-font-card={item.id} data-akari-catalog-item={item.key}
        data-akari-font-preview-path={fontPreviewPath(item.id)}
        data-akari-favorite={card.favorite ? 'true' : undefined}
        aria-label={item.title} title={item.title}
        onClick={card.onApply} onDragStart={card.onDragStart} onDragEnd={card.onDragEnd}
        onContextMenu={card.onContextMenu}
        onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault(); card.onApply();
        } }}
        style={{ display: 'flex', flexDirection: faceFamily ? 'row' : 'column',
            alignItems: faceFamily ? 'center' : 'stretch', gap: faceFamily ? '9px' : '5px', padding: '7px 8px', minWidth: 0,
            borderRadius: `${AKARI_RADIUS.panel}px`, background: AKARI_SURFACE.raised,
            color: AKARI_INK, border: AKARI_BORDER.ghost, cursor: 'grab' }}>
        {faceFamily ? <>{name}{actions}</> : <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '9px', minWidth: 0 }}>{name}{actions}</div>
            <div data-akari-font-preview style={{ width: '100%', height: '44px', overflow: 'hidden',
                background: AKARI_SURFACE.card, borderRadius: `${AKARI_RADIUS.chip}px`,
                display: 'flex', alignItems: 'center', justifyContent: 'flex-start' }}>
            {item.previewUrl
                ? <img src={item.previewUrl} alt='' draggable={false}
                    style={{ width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'left center' }} />
                : <small style={{ opacity: 0.6, fontSize: '0.66em' }}>見本は取得後</small>}
            </div>
        </>}
    </div>;
}

export function LibraryTextLookPage(props: { onBack(): void; onPlace(): void; tab: LibraryTextTab;
    onTabChange(tab: LibraryTextTab): void; styles: React.ReactNode; myStyles: React.ReactNode;
    motions: React.ReactNode; fonts: React.ReactNode }): React.ReactElement {
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
                style={{ position: 'relative', display: 'grid', gridTemplateColumns: '1fr 1fr', padding: '3px',
                    borderRadius: '8px', background: AKARI_SURFACE.elevated, border: AKARI_BORDER.edge }}>
                <span aria-hidden='true' style={{ position: 'absolute', top: '3px', bottom: '3px', left: '3px',
                    width: 'calc(50% - 3px)', borderRadius: '6px', background: AKARI_SURFACE.raised,
                    boxShadow: '0 1px 4px #0004', transform: props.tab === 'font' ? 'translateX(100%)' : undefined,
                    transition: 'transform .18s ease' }} />
                {(['style', 'font'] as const).map(tab => <button key={tab} type='button' role='tab'
                    data-akari-library-text-switch={tab} aria-selected={props.tab === tab}
                    onClick={() => props.onTabChange(tab)}
                    style={{ position: 'relative', border: 0, background: 'transparent', padding: '7px 4px',
                        color: props.tab === tab ? 'var(--akari-accent)' : AKARI_INK,
                        fontWeight: props.tab === tab ? 700 : 400, cursor: 'pointer', fontSize: '12px' }}>
                    {tab === 'style' ? 'スタイル' : 'フォント'}
                </button>)}
            </div>
        </div>
        {props.tab === 'style' ? <div role='tabpanel' data-akari-text-look-section='style'>
            <ShelfHeading label='テキストスタイル' hint='置く / かける' />
            <div style={GRID}>{props.styles}</div>
            {props.myStyles}
            <ShelfHeading label='テキストアニメ' hint='かける・ホバーで再生' />
            <div style={GRID}>{props.motions}</div>
        </div> : <div role='tabpanel' data-akari-text-look-section='font'>
            <ShelfHeading label='フォント' hint='置く / かける' />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', padding: '8px 10px 12px' }}>{props.fonts}</div>
        </div>}
    </div>;
}

function ShelfHeading(props: { label: string; hint: string }): React.ReactElement {
    return <div style={{ padding: '8px 10px 5px', background: AKARI_SURFACE.card,
        borderBottom: AKARI_BORDER.hairline, fontSize: '0.76em', fontWeight: 700 }}>
        {props.label} <small style={{ fontWeight: 400, opacity: 0.65 }}>— {props.hint}</small>
    </div>;
}
