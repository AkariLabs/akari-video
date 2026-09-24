import * as React from '@theia/core/shared/react';
import { AKARI_BORDER, AKARI_INK, AKARI_RADIUS, AKARI_SURFACE } from '../common/akari-surface-tokens';

const GRID = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '7px', padding: '8px 10px 12px' } as const;

export function LibraryTextLookRow(props: { counts: readonly [number, number, number]; onOpen(): void }): React.ReactElement {
    return <button type='button' data-akari-library-text-look-row onClick={props.onOpen}
        style={{ display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr) auto', alignItems: 'center', gap: '7px',
            width: '100%', padding: '6px 10px 6px 6px', textAlign: 'left', borderRadius: `${AKARI_RADIUS.panel}px`,
            cursor: 'pointer', background: AKARI_SURFACE.raised, color: AKARI_INK, border: AKARI_BORDER.ghost }}>
        <span aria-hidden='true' style={{ gridColumn: 1, gridRow: '1 / span 2', textAlign: 'center', fontSize: '1.3em', fontWeight: 700,
            color: 'var(--theia-button-background)' }}>A</span>
        <span style={{ gridColumn: 2, gridRow: 1, fontSize: '0.95em', fontWeight: 700 }}>スタイル・動き・フォント</span>
        <span style={{ gridColumn: 2, gridRow: 2, fontSize: '0.68em', opacity: 0.62 }}>選んだ文字に当てる</span>
        <span data-akari-library-text-look-count style={{ gridColumn: 3, gridRow: '1 / span 2', fontSize: '0.72em', opacity: 0.65 }}>
            {props.counts.join('·')}
        </span>
    </button>;
}

export function LibraryTextLookPage(props: { onBack(): void; styles: React.ReactNode; myStyles: React.ReactNode;
    motions: React.ReactNode; fonts: React.ReactNode }): React.ReactElement {
    return <div data-akari-library-text-look-page style={{ minHeight: '100%' }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 6, padding: '8px 10px 7px', background: AKARI_SURFACE.card,
            borderBottom: AKARI_BORDER.hairline, boxShadow: '0 8px 14px -12px var(--theia-widget-shadow)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                <button type='button' data-akari-library-back onClick={props.onBack}
                    style={{ padding: 0, border: 'none', background: 'transparent', color: 'var(--theia-textLink-foreground)',
                        cursor: 'pointer', fontSize: '0.8em' }}>← ライブラリ</button>
                <strong style={{ fontSize: '0.86em' }}>文字の見た目</strong>
            </div>
        </div>
        <section data-akari-text-look-section='style'>
            <ShelfHeading label='スタイル' hint='置く / かける' />
            <div style={GRID}>{props.styles}</div>
            {props.myStyles}
        </section>
        <section data-akari-text-look-section='motion'>
            <ShelfHeading label='動き' hint='かける・ホバーで再生' />
            <div style={GRID}>{props.motions}</div>
        </section>
        <section data-akari-text-look-section='font'>
            <ShelfHeading label='フォント' hint='かける' />
            <div style={GRID}>{props.fonts}</div>
        </section>
    </div>;
}

function ShelfHeading(props: { label: string; hint: string }): React.ReactElement {
    return <div style={{ position: 'sticky', top: '44px', zIndex: 4, padding: '8px 10px 5px', background: AKARI_SURFACE.card,
        borderBottom: AKARI_BORDER.hairline, fontSize: '0.76em', fontWeight: 700 }}>
        {props.label} <small style={{ fontWeight: 400, opacity: 0.65 }}>— {props.hint}</small>
    </div>;
}
