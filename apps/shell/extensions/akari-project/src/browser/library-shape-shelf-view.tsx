import * as React from '@theia/core/shared/react';
import { AKARI_BORDER, AKARI_RADIUS, AKARI_SURFACE } from '../common/akari-surface-tokens';
import {
    buildShapeShelfRows, searchShapeShelf, SHAPE_SHELF_LINE_KEY, shapeShelfRowItems, shapeShelfRowLabel,
    ShapeShelfPreset, ShapeShelfRow
} from '../common/shape-shelf';

/**
 * 図形の棚。図形だけを大きく出し、名前・カードの背景・説明・色は置かない（名前はツールチップと検索だけ）。
 * 見本の色はパネルの背景と逆（暗い背景 = 白・明るい背景 = 黒）。`color-scheme` はテーマが root に書くので
 * `light-dark()` でテーマに追従する。置いた後の色（灰・黒・白塗り + 黒枠）は見本の色とは別物。
 */
const CSS = `
[data-akari-shape-shelf] { --akari-shape-ink: light-dark(#000000, #ffffff); }
[data-akari-shape-track] { display:flex; gap:2px; overflow-x:auto; overscroll-behavior-x:contain; scroll-behavior:smooth; scrollbar-width:none; padding:2px 0; }
[data-akari-shape-track]::-webkit-scrollbar { display:none; }
[data-akari-shape-tile] { display:flex; align-items:center; justify-content:center; padding:0; margin:0; border:none; background:transparent;
    border-radius:${AKARI_RADIUS.chip}px; color:var(--akari-shape-ink); cursor:grab; user-select:none; }
[data-akari-shape-tile]:hover { background:color-mix(in srgb, var(--akari-shape-ink) 8%, transparent); }
[data-akari-shape-tile]:active { cursor:grabbing; }
[data-akari-shape-tile]:focus-visible { outline:2px solid var(--akari-accent, var(--theia-focusBorder)); outline-offset:-2px; }
[data-akari-shape-tile] svg { display:block; overflow:visible; pointer-events:none; }
[data-akari-shape-nav] { position:absolute; top:50%; transform:translateY(-50%); z-index:2; width:24px; height:24px; padding:0;
    display:flex; align-items:center; justify-content:center; border-radius:50%; cursor:pointer;
    background:var(--akari-elevated, var(--theia-editorWidget-background)); color:var(--akari-ink, inherit);
    border:1px solid var(--akari-line, var(--theia-widget-border)); box-shadow:0 2px 6px rgba(0,0,0,.28);
    opacity:0; pointer-events:none; transition:opacity .15s; }
[data-akari-shape-nav="prev"] { left:-4px; }
[data-akari-shape-nav="next"] { right:-4px; }
[data-akari-shape-row]:hover [data-akari-shape-nav][data-enabled="true"],
[data-akari-shape-nav][data-enabled="true"]:focus-visible { opacity:.96; pointer-events:auto; }
[data-akari-shape-show-all] { flex:0 0 auto; white-space:nowrap; padding:0; border:none; background:transparent; cursor:pointer; font-size:0.72em; color:var(--akari-muted, inherit); }
[data-akari-shape-show-all]:hover { color:var(--akari-ink, inherit); text-decoration:underline; }
@media (prefers-reduced-motion: reduce) { [data-akari-shape-track] { scroll-behavior:auto; } [data-akari-shape-nav] { transition:none; } }
`;

// FAB の上端（下端から 100px）+ 10px。preset-showcase の presetShowcaseBottomPadding と同じ値。
const SHELF_BOTTOM_PADDING = 100 + 10;
const TILE = 62;
const TILE_SVG = 50;
const LINE_TILE = 84;
const LINE_SVG_W = 76;
const LINE_SVG_H = 26;
const LINE_SVG_STROKE = 2.6;

type CapKind = 'none' | 'triangle' | 'chevron' | 'bar' | 'square' | 'circle' | 'diamond';

function capKind(value: unknown): CapKind {
    return (['triangle', 'chevron', 'bar', 'square', 'circle', 'diamond'] as const).includes(value as never)
        ? value as CapKind : 'none';
}

/** 端のパーツが線の端点からどれだけ内側を占めるか（線本体をそこで止める）。 */
function capInset(kind: CapKind, filled: boolean, size: number): number {
    if (kind === 'triangle') return size * 0.6;
    if (kind === 'square' || kind === 'circle' || kind === 'diamond') return filled ? size * 0.5 : size;
    return 0;
}

/** 端点 x・向き dir（始点 = -1 / 終点 = +1）のパーツ 1 個。 */
function capElement(kind: CapKind, filled: boolean, x: number, y: number, dir: number, size: number, sw: number, key: string): React.ReactNode {
    const half = size / 2;
    const center = x - dir * half;
    const outline = Math.max(1.2, sw * 0.7);
    const paint = filled ? { fill: 'currentColor' } : { fill: 'none', stroke: 'currentColor', strokeWidth: outline };
    const inner = filled ? 0 : outline / 2;
    switch (kind) {
        case 'triangle':
            return <polygon key={key} points={`${x},${y} ${x - dir * size},${y - half} ${x - dir * size},${y + half}`} fill='currentColor' />;
        case 'chevron':
            return <polyline key={key} points={`${x - dir * size * 0.75},${y - half} ${x},${y} ${x - dir * size * 0.75},${y + half}`}
                fill='none' stroke='currentColor' strokeWidth={sw} strokeLinecap='round' strokeLinejoin='round' />;
        case 'bar':
            return <line key={key} x1={x} y1={y - half} x2={x} y2={y + half} stroke='currentColor' strokeWidth={sw} />;
        case 'square':
            return <rect key={key} x={center - half + inner} y={y - half + inner} width={size - inner * 2} height={size - inner * 2} {...paint} />;
        case 'circle':
            return <circle key={key} cx={center} cy={y} r={half - inner} {...paint} />;
        case 'diamond':
            return <polygon key={key} points={`${center - half + inner},${y} ${center},${y - half + inner} ${center + half - inner},${y} ${center},${y + half - inner}`} {...paint} />;
        default:
            return undefined;
    }
}

function LineThumb(props: { preset: ShapeShelfPreset }): React.ReactElement {
    const p = props.preset.defaults;
    const sw = LINE_SVG_STROKE;
    const size = Math.max(sw * 3.2, 8);
    const y = LINE_SVG_H / 2;
    const start = capKind(p.startCap);
    const end = capKind(p.endCap);
    const startFilled = p.startCapFilled !== false;
    const endFilled = p.endCapFilled !== false;
    const gap = Math.max(sw * 2, 3);
    const dash = p.dash === 'dash' ? `${sw * 3} ${gap}` : p.dash === 'dot' ? `${sw} ${gap}` : undefined;
    return (
        <svg width={LINE_SVG_W} height={LINE_SVG_H} viewBox={`0 0 ${LINE_SVG_W} ${LINE_SVG_H}`} aria-hidden='true'>
            <line x1={capInset(start, startFilled, size)} y1={y} x2={LINE_SVG_W - capInset(end, endFilled, size)} y2={y}
                stroke='currentColor' strokeWidth={sw} strokeLinecap='butt' strokeDasharray={dash} />
            {capElement(start, startFilled, 0, y, -1, size, sw, 'start')}
            {capElement(end, endFilled, LINE_SVG_W, y, 1, size, sw, 'end')}
        </svg>
    );
}

function ShapeThumb(props: { preset: ShapeShelfPreset }): React.ReactElement {
    const { preset } = props;
    const [width, height] = preset.vb;
    // 塗りだと楕円と見分けが付かない破線の吹き出し（ひそひそ）と、線の図形（波線）は見本だけ線で描く。
    const outlined = preset.kind === 'stroke' || (preset.kind === 'bubble' && preset.defaults.dash !== undefined && preset.defaults.dash !== 'solid');
    return (
        <svg width={TILE_SVG} height={TILE_SVG} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio='xMidYMid meet' aria-hidden='true'>
            {outlined
                ? <path d={preset.d} fill='none' stroke='currentColor' strokeWidth={preset.kind === 'stroke' ? 2.5 : 2}
                    strokeDasharray={preset.kind === 'bubble' ? '4 3' : undefined} strokeLinecap='round' strokeLinejoin='round'
                    vectorEffect='non-scaling-stroke' />
                : <path d={preset.d} fill='currentColor' fillRule={preset.rule ?? 'nonzero'} />}
        </svg>
    );
}

export interface LibraryShapeShelfProps {
    readonly presets: readonly ShapeShelfPreset[];
    readonly recent: readonly string[];
    readonly loaded: boolean;
    readonly query: string;
    /** 「すべて表示」で開いている行。undefined = 棚。 */
    readonly view?: string;
    onBack(): void;
    onShowAll(key: string | undefined): void;
    onPlace(preset: ShapeShelfPreset): void;
    onDragStart(event: React.DragEvent<HTMLElement>, preset: ShapeShelfPreset): void;
    onDragEnd(): void;
}

function ShapeTile(props: { preset: ShapeShelfPreset; grid?: boolean } & Pick<LibraryShapeShelfProps, 'onPlace' | 'onDragStart' | 'onDragEnd'>): React.ReactElement {
    const { preset } = props;
    const line = preset.kind === 'line';
    return (
        <button type='button' draggable data-akari-shape-tile={preset.id} data-akari-shape-kind={preset.kind}
            title={preset.name} aria-label={preset.name}
            onClick={event => { event.stopPropagation(); props.onPlace(preset); }}
            onDragStart={event => props.onDragStart(event, preset)}
            onDragEnd={() => props.onDragEnd()}
            style={props.grid
                ? { width: '100%', height: line ? '48px' : `${TILE}px` }
                : { flex: `0 0 ${line ? LINE_TILE : TILE}px`, height: `${TILE}px` }}>
            {line ? <LineThumb preset={preset} /> : <ShapeThumb preset={preset} />}
        </button>
    );
}

function ShapeGrid(props: { presets: readonly ShapeShelfPreset[]; lines?: boolean } & Pick<LibraryShapeShelfProps, 'onPlace' | 'onDragStart' | 'onDragEnd'>): React.ReactElement {
    return (
        <div data-akari-shape-grid={props.lines ? 'lines' : 'shapes'} style={{
            display: 'grid', gap: '2px',
            gridTemplateColumns: `repeat(auto-fill, minmax(${props.lines ? LINE_TILE : TILE}px, 1fr))`
        }}>
            {props.presets.map(preset => <ShapeTile key={preset.id} preset={preset} grid
                onPlace={props.onPlace} onDragStart={props.onDragStart} onDragEnd={props.onDragEnd} />)}
        </div>
    );
}

function ShapeRow(props: { row: ShapeShelfRow } & Pick<LibraryShapeShelfProps, 'onShowAll' | 'onPlace' | 'onDragStart' | 'onDragEnd'>): React.ReactElement {
    const { row } = props;
    const track = React.useRef<HTMLDivElement>(null);
    const [edges, setEdges] = React.useState({ prev: false, next: false });
    const measure = React.useCallback(() => {
        const node = track.current;
        if (!node) return;
        const next = { prev: node.scrollLeft > 1, next: node.scrollLeft + node.clientWidth < node.scrollWidth - 1 };
        setEdges(current => current.prev === next.prev && current.next === next.next ? current : next);
    }, []);
    React.useEffect(() => {
        measure();
        const node = track.current;
        if (!node || typeof ResizeObserver === 'undefined') return undefined;
        const observer = new ResizeObserver(measure);
        observer.observe(node);
        return () => observer.disconnect();
    }, [measure, row.items.length]);
    const scroll = (dir: -1 | 1): void => {
        const node = track.current;
        if (node) node.scrollBy({ left: dir * Math.max(120, node.clientWidth * 0.8) });
    };
    return (
        <section data-akari-shape-row={row.key} data-akari-shape-row-total={row.total} style={{ paddingTop: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px', padding: '0 2px 4px' }}>
                <strong title={row.label} style={{ fontSize: '0.8em', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.label}</strong>
                <button type='button' data-akari-shape-show-all={row.key}
                    onClick={event => { event.stopPropagation(); props.onShowAll(row.key); }}>すべて表示</button>
            </div>
            <div style={{ position: 'relative' }}>
                <button type='button' data-akari-shape-nav='prev' data-enabled={String(edges.prev)} aria-label={`${row.label}を左へ`}
                    tabIndex={edges.prev ? 0 : -1} onClick={event => { event.stopPropagation(); scroll(-1); }}>
                    <span className='codicon codicon-chevron-left' aria-hidden='true' />
                </button>
                <div ref={track} data-akari-shape-track={row.key} onScroll={measure}>
                    {row.items.map(preset => <ShapeTile key={preset.id} preset={preset}
                        onPlace={props.onPlace} onDragStart={props.onDragStart} onDragEnd={props.onDragEnd} />)}
                </div>
                <button type='button' data-akari-shape-nav='next' data-enabled={String(edges.next)} aria-label={`${row.label}を右へ`}
                    tabIndex={edges.next ? 0 : -1} onClick={event => { event.stopPropagation(); scroll(1); }}>
                    <span className='codicon codicon-chevron-right' aria-hidden='true' />
                </button>
            </div>
        </section>
    );
}

export function LibraryShapeShelf(props: LibraryShapeShelfProps): React.ReactElement {
    const query = props.query.trim();
    const tileHandlers = { onPlace: props.onPlace, onDragStart: props.onDragStart, onDragEnd: props.onDragEnd };
    let body: React.ReactNode;
    let title = '図形';
    let count = props.presets.length;
    if (!props.presets.length) {
        body = <p style={{ opacity: 0.7, padding: '12px 2px' }}>{props.loaded ? '図形の棚を読み込めませんでした。' : '読み込み中…'}</p>;
    } else if (query) {
        const hits = searchShapeShelf(props.presets, query);
        const shapes = hits.filter(preset => preset.kind !== 'line');
        const lines = hits.filter(preset => preset.kind === 'line');
        count = hits.length;
        body = hits.length
            ? <div data-akari-shape-search-results={hits.length} style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '10px' }}>
                {shapes.length > 0 && <ShapeGrid presets={shapes} {...tileHandlers} />}
                {lines.length > 0 && <ShapeGrid presets={lines} lines {...tileHandlers} />}
            </div>
            : <p data-akari-shape-search-results={0} style={{ opacity: 0.7, padding: '12px 2px' }}>条件に一致する図形がありません。</p>;
    } else if (props.view) {
        const items = shapeShelfRowItems(props.presets, props.view, props.recent);
        title = shapeShelfRowLabel(props.view);
        count = items.length;
        body = <div style={{ paddingTop: '10px' }}>
            <ShapeGrid presets={items} lines={props.view === SHAPE_SHELF_LINE_KEY} {...tileHandlers} />
        </div>;
    } else {
        body = buildShapeShelfRows(props.presets, props.recent).map(row =>
            <ShapeRow key={row.key} row={row} onShowAll={props.onShowAll} {...tileHandlers} />);
    }
    const inside = props.view !== undefined && !query;
    return (
        <div data-akari-shape-shelf data-akari-library-category='shapes' data-akari-shape-view={inside ? props.view : undefined}
            style={{ minHeight: '100%' }}>
            <style data-akari-shape-shelf-css>{CSS}</style>
            <div style={{
                position: 'sticky', top: 0, zIndex: 6, padding: '8px 10px 7px',
                background: AKARI_SURFACE.card, borderBottom: AKARI_BORDER.hairline,
                boxShadow: '0 8px 14px -12px var(--theia-widget-shadow)'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                    <button type='button' data-akari-library-back={inside ? undefined : true} data-akari-shape-back={inside ? true : undefined}
                        onClick={event => { event.stopPropagation(); if (inside) props.onShowAll(undefined); else props.onBack(); }}
                        style={{ flex: '0 0 auto', whiteSpace: 'nowrap', padding: 0, border: 'none', background: 'transparent', color: 'var(--theia-textLink-foreground)', cursor: 'pointer', fontSize: '0.8em' }}>
                        {inside ? '← 図形' : '← ライブラリ'}
                    </button>
                    <strong style={{ flex: '1 1 auto', minWidth: 0, fontSize: '0.86em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</strong>
                    <span data-akari-library-category-count={count} style={{ opacity: 0.6, fontSize: '0.72em' }}>{count}</span>
                </div>
            </div>
            {/* 下はライブラリの「追加」ボタン（FAB・高さ 42px・下端から 58px）の分だけ空け、最後の行を FAB の上まで送れるようにする */}
            <div style={{ padding: `0 10px ${SHELF_BOTTOM_PADDING}px` }}>{body}</div>
        </div>
    );
}
