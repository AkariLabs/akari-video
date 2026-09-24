/**
 * ライブラリのカードまわりの描画（ウィジェット本体から切り出した部品）。
 *
 * - カード = 顔（サムネ）+ 名前 + ⋯。サムネの上に残すのは プレミアムの王冠（左上）・取得状態の印（左下）・
 *   ⋯（右上）・音の試聴（右下）だけ。ライセンス・タグ・カテゴリ・使用回数・＋・使う・価格はカードに出さない
 * - ⋯ = 情報カード（周りを暗くして押したカードだけ残し、横に情報カード）
 * - ⓘ = ライセンスの窓 / 検索の右のフィルター / プレミアムの促しのシート
 *
 * 色・線・角丸はすべて akari-surface-tokens（`--akari-*`）の参照にして、暗い・明るいの両テーマで成立させる。
 * 記号は既存のアイコン部品（codicon）か SVG で描く（絵文字は使わない）。
 */
import * as React from '@theia/core/shared/react';
import { createPortal } from '@theia/core/shared/react-dom';
import type { AssetCatalogViewItem } from '../common/akari-project-protocol';
import { AKARI_BORDER, AKARI_FAINT, AKARI_INK, AKARI_LINE, AKARI_RADIUS, AKARI_SURFACE } from '../common/akari-surface-tokens';
import { LibraryInfoCardAction, LibraryInfoCardModel, LIBRARY_INFO_KEYWORD_LIMIT } from '../common/library-card-menu';
import {
    isLibraryFilterOptionOn, LibraryFilterSectionKey, LibraryFilterState, LIBRARY_FILTER_SECTIONS, libraryFilterCount
} from '../common/library-filter';
import { LibraryLicenseMark, LibraryLicenseSheet } from '../common/library-license';

const ACCENT = 'var(--akari-accent)';
const ACCENT_LIGHT = 'var(--akari-accent-light, var(--akari-accent))';
const MUTED = 'var(--akari-muted, var(--theia-descriptionForeground))';
/** サムネの上に載せる座布団。写真の上に置くので両テーマとも暗い半透明。 */
const ON_THUMB = 'rgba(0, 0, 0, 0.58)';
/** 暗い座布団の上の王冠。座布団がテーマに依らず暗いので、色も両テーマ共通の明るい金にする。 */
const CROWN_ON_THUMB = '#ffc857';
const FLOAT_SHADOW = '0 18px 48px rgba(0, 0, 0, 0.42), 0 2px 8px rgba(0, 0, 0, 0.18)';
const MARK_COLORS: Readonly<Record<LibraryLicenseMark, string>> = {
    ok: 'var(--theia-terminal-ansiGreen, #3fb950)',
    ng: 'var(--theia-errorForeground, #f14c4c)',
    warn: 'var(--theia-editorWarning-foreground, #cca700)'
};

/** ホバー・フォーカスはインラインで書けないので、カード用の最小のスタイルだけを 1 か所に置く。 */
export const LIBRARY_CARD_CSS = `
[data-akari-library-card] { transition: border-color .12s ease; }
[data-akari-library-card]:hover { border-color: ${ACCENT_LIGHT} !important; }
[data-akari-library-card] [data-akari-library-dots] { opacity: .72; transition: opacity .12s ease, background .12s ease; }
[data-akari-library-card]:hover [data-akari-library-dots],
[data-akari-library-card] [data-akari-library-dots]:focus-visible,
[data-akari-library-card] [data-akari-library-dots][aria-expanded="true"] { opacity: 1; }
[data-akari-library-dots]:hover { filter: brightness(1.25); }
[data-akari-library-chip]:hover { border-color: ${ACCENT_LIGHT} !important; }
[data-akari-library-info-card] button[data-akari-info-action]:hover { filter: brightness(1.08); }
[data-akari-library-link]:hover { text-decoration: underline; }
`;

export function LibraryCardStyles(): React.ReactElement {
    return <style data-akari-library-card-css>{LIBRARY_CARD_CSS}</style>;
}

// --- 記号（SVG） ------------------------------------------------------------------------------

/** プレミアムの王冠。 */
export function CrownIcon(props: { size?: number; color?: string }): React.ReactElement {
    const size = props.size ?? 12;
    return (
        <svg width={size} height={size} viewBox='0 0 24 24' aria-hidden='true' focusable='false' style={{ display: 'block' }}>
            <path fill={props.color ?? 'currentColor'}
                d='M3 7.2l4.6 3.9L12 4l4.4 7.1L21 7.2l-1.9 10.3H4.9L3 7.2zm2.2 11.8h13.6v2H5.2v-2z' />
        </svg>
    );
}

function MarkIcon(props: { mark: LibraryLicenseMark }): React.ReactElement {
    const color = MARK_COLORS[props.mark];
    return (
        <svg width='18' height='18' viewBox='0 0 18 18' aria-hidden='true' focusable='false' style={{ display: 'block', flex: '0 0 auto', marginTop: '1px' }}>
            <circle cx='9' cy='9' r='8.2' fill='none' stroke={color} strokeWidth='1.4' />
            {props.mark === 'ok' && <path d='M5.2 9.3l2.4 2.4 5-5.1' fill='none' stroke={color} strokeWidth='1.7' strokeLinecap='round' strokeLinejoin='round' />}
            {props.mark === 'ng' && <path d='M6.2 6.2l5.6 5.6M11.8 6.2l-5.6 5.6' fill='none' stroke={color} strokeWidth='1.7' strokeLinecap='round' />}
            {props.mark === 'warn' && <>
                <path d='M9 4.8v5.1' stroke={color} strokeWidth='1.8' strokeLinecap='round' />
                <circle cx='9' cy='12.9' r='1.05' fill={color} />
            </>}
        </svg>
    );
}

function Codicon(props: { name: string; size?: number; style?: React.CSSProperties }): React.ReactElement {
    return <span className={`codicon codicon-${props.name}`} aria-hidden='true' style={{ fontSize: `${props.size ?? 13}px`, ...props.style }} />;
}

// --- カードの顔の上の部品 --------------------------------------------------------------------

export function PremiumCrownBadge(): React.ReactElement {
    return (
        <span data-akari-premium-crown title='Lab のプレミアム' aria-label='Lab のプレミアム'
            style={{
                position: 'absolute', left: '5px', top: '5px', zIndex: 1, display: 'flex', alignItems: 'center',
                justifyContent: 'center', width: '22px', height: '22px', borderRadius: '999px',
                background: ON_THUMB, color: CROWN_ON_THUMB, pointerEvents: 'auto'
            }}>
            <CrownIcon size={13} />
        </span>
    );
}

/** 取得状態の小さな印（cached = 手元にある / remote = 使うときに取得）。 */
export function AssetStateMark(props: { state: 'cached' | 'remote' }): React.ReactElement {
    const cached = props.state === 'cached';
    return (
        <span data-akari-asset-mark={props.state} title={cached ? '取得済み' : '未取得（使うときに取得）'}
            aria-label={cached ? '取得済み' : '未取得'}
            style={{
                position: 'absolute', left: '5px', bottom: '5px', zIndex: 1, display: 'flex', alignItems: 'center',
                justifyContent: 'center', width: '20px', height: '16px', borderRadius: '999px',
                background: ON_THUMB, color: cached ? 'rgba(255, 255, 255, 0.86)' : 'rgba(255, 255, 255, 0.72)'
            }}>
            <Codicon name={cached ? 'check' : 'cloud'} size={11} />
        </span>
    );
}

export function LibraryDotsButton(props: {
    label: string; expanded?: boolean;
    /** thumb = サムネの右上（暗い座布団）/ plain = 面の右上（座布団なし）/ inline = 行の中。 */
    variant?: 'thumb' | 'plain' | 'inline';
    onOpen(anchor: HTMLElement): void;
}): React.ReactElement {
    const variant = props.variant ?? 'thumb';
    const onThumb = variant === 'thumb';
    return (
        <button type='button' data-akari-library-dots aria-label={`${props.label} の情報`} title='情報を見る'
            aria-haspopup='dialog' aria-expanded={props.expanded ? 'true' : 'false'}
            draggable={false}
            onMouseDown={event => event.stopPropagation()}
            onClick={event => {
                event.stopPropagation();
                const card = (event.currentTarget.closest('[data-akari-library-card]') as HTMLElement | null) ?? event.currentTarget;
                props.onOpen(card);
            }}
            style={{
                ...(variant === 'inline' ? { position: 'relative', flex: '0 0 auto' } : { position: 'absolute', right: '4px', top: '4px', zIndex: 2 }),
                display: 'flex', alignItems: 'center', justifyContent: 'center', width: '22px', height: '22px',
                padding: 0, margin: 0, border: 'none', borderRadius: `${AKARI_RADIUS.chip}px`,
                background: onThumb ? ON_THUMB : 'transparent', color: onThumb ? '#ffffff' : AKARI_INK, cursor: 'pointer'
            }}>
            <Codicon name='ellipsis' size={14} />
        </button>
    );
}

/** サムネを持たない小さなカード（トランジション）の右上の ⋯。 */
export function LibraryDotsCorner(props: { label: string; expanded?: boolean; onOpen(anchor: HTMLElement): void }): React.ReactElement {
    return <LibraryDotsButton variant='plain' {...props} />;
}

// --- カード（グリッド / リスト） ---------------------------------------------------------------

export interface LibraryAssetCardProps {
    item: AssetCatalogViewItem;
    layout: 'grid' | 'list';
    premium: boolean;
    cached: boolean;
    favorite: boolean;
    thumbnailBroken: boolean;
    placeholderIcon: string;
    /** 生成の差し込みモードの属性・札（ウィジェット既存の部品をそのまま渡す）。 */
    pickProps: React.HTMLAttributes<HTMLDivElement>;
    pickBadge: React.ReactNode;
    /** false = 差し込みモード中（⋯・試聴を出さない）。 */
    interactive: boolean;
    draggable: boolean;
    infoOpen: boolean;
    audioControl: React.ReactNode;
    audioError: React.ReactNode;
    uiTarget: { target: string; label: string };
    onDragStart(event: React.DragEvent<HTMLElement>): void;
    onDragEnd(): void;
    onContextMenu(event: React.MouseEvent<HTMLElement>): void;
    onInfo(anchor: HTMLElement): void;
    onThumbnailError(): void;
}

function Thumbnail(props: LibraryAssetCardProps & { compact?: boolean }): React.ReactElement {
    const { item } = props;
    return props.item.previewUrl && !props.thumbnailBroken
        ? <img src={item.previewUrl} alt='' draggable={false} onError={() => props.onThumbnailError()}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        : <span className={props.placeholderIcon} aria-hidden='true' style={{ fontSize: props.compact ? '1em' : '1.45em', opacity: 0.5 }} />;
}

function FavoriteStar(): React.ReactElement {
    return <Codicon name='star-full' size={11} style={{ color: ACCENT_LIGHT, flex: '0 0 auto' }} />;
}

export function LibraryAssetCard(props: LibraryAssetCardProps): React.ReactElement {
    const { item } = props;
    const common = {
        title: item.title,
        ...props.pickProps,
        draggable: props.draggable,
        onDragStart: props.onDragStart,
        onDragEnd: () => props.onDragEnd(),
        onContextMenu: props.onContextMenu,
        'data-akari-library-card': props.layout,
        'data-akari-catalog-item': item.key,
        'data-akari-catalog-item-state': item.state ?? 'local',
        'data-akari-premium': props.premium ? 'true' : undefined,
        'data-akari-favorite': props.favorite ? 'true' : undefined,
        // docs/contract-2026-08-11-review-session-ui-events.md #2: asset:<catalog key> opt-in target.
        'data-akari-ui': props.uiTarget.target,
        'data-akari-ui-label': props.uiTarget.label
    };
    const marks = <>
        {props.premium && <PremiumCrownBadge />}
        {!props.premium && <AssetStateMark state={props.cached ? 'cached' : 'remote'} />}
    </>;
    if (props.layout === 'list') {
        return (
            <div key={item.key} {...common} data-akari-catalog-list-row
                style={{
                    display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, padding: '5px 6px',
                    borderRadius: `${AKARI_RADIUS.panel}px`, background: AKARI_SURFACE.raised, border: AKARI_BORDER.ghost,
                    cursor: props.draggable ? 'grab' : 'default'
                }}>
                <div style={{
                    position: 'relative', width: '52px', height: '30px', flex: '0 0 auto', overflow: 'hidden',
                    borderRadius: `${AKARI_RADIUS.chip}px`, background: AKARI_SURFACE.card,
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                    <Thumbnail {...props} compact />
                </div>
                <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '1px' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0, fontSize: '0.82em' }}>
                        {props.favorite && <FavoriteStar />}
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</span>
                    </span>
                    {props.audioError}
                </div>
                {props.premium && <span data-akari-premium-crown title='Lab のプレミアム' aria-label='Lab のプレミアム'
                    style={{ flex: '0 0 auto', color: ACCENT_LIGHT, display: 'flex' }}><CrownIcon size={13} /></span>}
                {!props.premium && <span data-akari-asset-mark={props.cached ? 'cached' : 'remote'}
                    title={props.cached ? '取得済み' : '未取得（使うときに取得）'}
                    style={{ flex: '0 0 auto', color: AKARI_FAINT, display: 'flex' }}><Codicon name={props.cached ? 'check' : 'cloud'} size={12} /></span>}
                {props.pickBadge}
                {props.interactive && props.audioControl}
                {props.interactive && <LibraryDotsButton variant='inline' label={item.title} expanded={props.infoOpen} onOpen={props.onInfo} />}
            </div>
        );
    }
    return (
        <div key={item.key} {...common}
            style={{
                display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden',
                borderRadius: `${AKARI_RADIUS.panel}px`, background: AKARI_SURFACE.raised, border: AKARI_BORDER.ghost,
                cursor: props.draggable ? 'grab' : 'default'
            }}>
            <div style={{
                position: 'relative', aspectRatio: '16 / 9', overflow: 'hidden', background: AKARI_SURFACE.card,
                display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
                <Thumbnail {...props} />
                {marks}
                {props.interactive && <LibraryDotsButton label={item.title} expanded={props.infoOpen} onOpen={props.onInfo} />}
                {props.interactive && props.audioControl}
            </div>
            {props.pickBadge}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0, padding: '5px 7px 6px' }}>
                {props.favorite && <FavoriteStar />}
                <span style={{ flex: '1 1 auto', minWidth: 0, fontSize: '0.78em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.title}
                </span>
            </div>
            {props.audioError && <div style={{ padding: '0 7px 6px' }}>{props.audioError}</div>}
        </div>
    );
}

/** プリセット（テキストスタイル・テキストアニメ・LUT）・マイスタイル・トランジションのカードの共通の顔。 */
export interface LibrarySimpleCardProps {
    cardKey: string;
    name: string;
    layout: 'grid' | 'list';
    face: React.ReactNode;
    favorite: boolean;
    infoOpen: boolean;
    /** 既存の data 属性（data-akari-catalog-preset-item 等）はそのまま渡す。 */
    attributes: Record<string, string | boolean | undefined>;
    title?: string;
    draggable?: boolean;
    faceHeight?: string;
    onDragStart?(event: React.DragEvent<HTMLElement>): void;
    onDragEnd?(): void;
    onMouseEnter?(event: React.MouseEvent<HTMLElement>): void;
    onMouseLeave?(event: React.MouseEvent<HTMLElement>): void;
    onContextMenu(event: React.MouseEvent<HTMLElement>): void;
    onInfo(anchor: HTMLElement): void;
}

export function LibrarySimpleCard(props: LibrarySimpleCardProps): React.ReactElement {
    const shared = {
        title: props.title ?? props.name,
        draggable: props.draggable,
        onDragStart: props.onDragStart,
        onDragEnd: props.onDragEnd ? () => props.onDragEnd!() : undefined,
        onMouseEnter: props.onMouseEnter,
        onMouseLeave: props.onMouseLeave,
        onContextMenu: props.onContextMenu,
        'data-akari-library-card': props.layout,
        'data-akari-favorite': props.favorite ? 'true' : undefined,
        ...props.attributes
    };
    if (props.layout === 'list') {
        return (
            <div key={props.cardKey} {...shared} style={{
                display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, padding: '5px 6px',
                borderRadius: `${AKARI_RADIUS.panel}px`, background: AKARI_SURFACE.raised, border: AKARI_BORDER.ghost,
                cursor: props.draggable ? 'grab' : 'default'
            }}>
                <div style={{ width: '54px', height: '32px', flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    overflow: 'hidden', borderRadius: `${AKARI_RADIUS.chip}px`, background: AKARI_SURFACE.card }}>
                    {props.face}
                </div>
                <span style={{ flex: '1 1 auto', display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0, fontSize: '0.82em' }}>
                    {props.favorite && <FavoriteStar />}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{props.name}</span>
                </span>
                <LibraryDotsButton variant='inline' label={props.name} expanded={props.infoOpen} onOpen={props.onInfo} />
            </div>
        );
    }
    return (
        <div key={props.cardKey} {...shared} style={{
            display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden', borderRadius: `${AKARI_RADIUS.panel}px`,
            background: AKARI_SURFACE.raised, border: AKARI_BORDER.ghost, cursor: props.draggable ? 'grab' : 'default'
        }}>
            <div style={{
                position: 'relative', ...(props.faceHeight ? { height: props.faceHeight } : { aspectRatio: '16 / 9' }),
                display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: AKARI_SURFACE.card
            }}>
                {props.face}
                <LibraryDotsButton variant='plain' label={props.name} expanded={props.infoOpen} onOpen={props.onInfo} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0, padding: '5px 7px 6px' }}>
                {props.favorite && <FavoriteStar />}
                <span style={{ flex: '1 1 auto', minWidth: 0, fontSize: '0.78em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{props.name}</span>
            </div>
        </div>
    );
}

// --- 浮く部品の共通 ---------------------------------------------------------------------------

/** Esc で閉じる。`above` の層が開いているあいだは、上の層に譲る（ライセンスの窓 → 情報カードの順に閉じる）。 */
function useEscape(onClose: () => void, above?: string): void {
    React.useEffect(() => {
        const listener = (event: KeyboardEvent): void => {
            if (event.key !== 'Escape') return;
            if (above && document.querySelector(above)) return;
            event.preventDefault();
            event.stopPropagation();
            onClose();
        };
        window.addEventListener('keydown', listener, true);
        return () => window.removeEventListener('keydown', listener, true);
    }, [onClose, above]);
}

function Portal(props: { children: React.ReactNode }): React.ReactElement {
    return createPortal(props.children, document.body) as unknown as React.ReactElement;
}

const floatingSurface: React.CSSProperties = {
    background: AKARI_SURFACE.raised, color: AKARI_INK, border: AKARI_BORDER.edge,
    borderRadius: `${AKARI_RADIUS.card}px`, boxShadow: FLOAT_SHADOW, fontFamily: 'var(--theia-ui-font-family)'
};

function ActionButton(props: { action: LibraryInfoCardAction; favorite: boolean; onClick(): void }): React.ReactElement {
    const { action } = props;
    const star = action.id === 'favorite';
    return (
        <button type='button' data-akari-info-action={action.id} onClick={props.onClick}
            aria-pressed={star ? props.favorite : undefined}
            style={{
                display: 'flex', alignItems: 'center', justifyContent: star ? 'center' : 'flex-start', gap: '7px',
                flex: star ? '0 0 34px' : '1 1 auto', minWidth: 0, height: '32px', margin: 0,
                padding: star ? 0 : '0 11px', borderRadius: `${AKARI_RADIUS.panel}px`, cursor: 'pointer', fontSize: '12.5px',
                fontWeight: action.primary ? 700 : 500, fontFamily: 'inherit',
                background: action.primary ? ACCENT : AKARI_SURFACE.elevated,
                color: action.primary ? 'var(--akari-bg)' : star && props.favorite ? ACCENT_LIGHT : AKARI_INK,
                border: action.primary ? '1px solid transparent' : AKARI_BORDER.hairline
            }}
            title={star ? action.label : undefined} aria-label={star ? action.label : undefined}>
            {action.icon && <Codicon name={action.icon} size={star ? 15 : 13} />}
            {!star && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{action.label}</span>}
        </button>
    );
}

// --- ⋯ = 情報カード --------------------------------------------------------------------------

export interface LibraryInfoCardProps {
    model: LibraryInfoCardModel;
    anchor: DOMRect;
    favorite: boolean;
    keywordsExpanded: boolean;
    onToggleKeywords(): void;
    onAction(id: LibraryInfoCardAction['id']): void;
    onOpenLicense(): void;
    onCreator?(): void;
    onClose(): void;
}

const INFO_WIDTH = 300;

export function LibraryInfoCard(props: LibraryInfoCardProps): React.ReactElement {
    const { model, anchor } = props;
    const ref = React.useRef<HTMLDivElement>(null);
    const [top, setTop] = React.useState(Math.max(12, anchor.top - 8));
    useEscape(props.onClose, '[data-akari-license-layer], [data-akari-premium-layer]');
    React.useLayoutEffect(() => {
        const height = ref.current?.offsetHeight ?? 0;
        setTop(Math.max(12, Math.min(window.innerHeight - height - 12, anchor.top - 8)));
    }, [anchor.top, props.keywordsExpanded, model.key]);
    React.useEffect(() => {
        const close = (): void => props.onClose();
        window.addEventListener('resize', close);
        return () => window.removeEventListener('resize', close);
    }, [props.onClose]);
    const right = anchor.right + 14 + INFO_WIDTH <= window.innerWidth - 12;
    const left = right ? anchor.right + 14 : Math.max(12, anchor.left - 14 - INFO_WIDTH);
    const keywords = props.keywordsExpanded ? model.keywords : model.keywords.slice(0, LIBRARY_INFO_KEYWORD_LIMIT);
    const initial = Array.from(model.creator.trim())[0]?.toUpperCase() ?? 'A';
    return (
        <Portal>
            <div data-akari-library-info-layer onMouseDown={event => { if (event.target === event.currentTarget) props.onClose(); }}
                onWheel={() => props.onClose()}
                onContextMenu={event => { event.preventDefault(); props.onClose(); }}
                style={{ position: 'fixed', inset: 0, zIndex: 9000 }}>
                <div data-akari-library-spotlight aria-hidden='true' style={{
                    position: 'fixed', left: `${anchor.left - 3}px`, top: `${anchor.top - 3}px`,
                    width: `${anchor.width + 6}px`, height: `${anchor.height + 6}px`, borderRadius: `${AKARI_RADIUS.panel + 3}px`,
                    boxShadow: `0 0 0 2px ${ACCENT_LIGHT}, 0 0 0 200vmax rgba(0, 0, 0, 0.56)`, pointerEvents: 'none'
                }} />
                <div ref={ref} role='dialog' aria-label={`${model.name} の情報`} data-akari-library-info-card={model.key}
                    onMouseDown={event => event.stopPropagation()}
                    style={{ ...floatingSurface, position: 'fixed', left: `${left}px`, top: `${top}px`, width: `${INFO_WIDTH}px`, overflow: 'hidden' }}>
                    <div style={{ padding: '14px 16px 10px' }}>
                        <div data-akari-info-name style={{ fontSize: '15px', fontWeight: 800, lineHeight: 1.35, marginBottom: '8px', wordBreak: 'break-word' }}>{model.name}</div>
                        <div style={{ display: 'flex', gap: '9px', alignItems: 'center' }}>
                            <span aria-hidden='true' style={{
                                width: '28px', height: '28px', flex: '0 0 auto', borderRadius: '999px', display: 'flex', alignItems: 'center',
                                justifyContent: 'center', background: AKARI_SURFACE.elevated, border: AKARI_BORDER.hairline,
                                color: ACCENT_LIGHT, fontWeight: 800, fontSize: '12px'
                            }}>{initial}</span>
                            <div style={{ minWidth: 0, fontSize: '11.5px', lineHeight: 1.5 }}>
                                <div data-akari-info-creator style={{ color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>作成: {model.creator}</div>
                                {props.onCreator && <button type='button' data-akari-info-creator-more data-akari-library-link onClick={props.onCreator}
                                    style={{ padding: 0, margin: 0, border: 'none', background: 'transparent', color: ACCENT_LIGHT, cursor: 'pointer', fontSize: '11.5px', fontFamily: 'inherit', textAlign: 'left' }}>
                                    この作成元の素材をもっと見る
                                </button>}
                            </div>
                        </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '4px 16px 2px' }}>
                        <span data-akari-info-price={model.price.kind} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 700 }}>
                            {model.price.kind === 'premium' && <span style={{ color: ACCENT_LIGHT, display: 'flex' }}><CrownIcon size={14} /></span>}
                            {model.price.label}
                        </span>
                        <button type='button' data-akari-license-open onClick={props.onOpenLicense} title='ライセンスを詳しく見る' aria-label='ライセンスを詳しく見る'
                            style={{
                                width: '26px', height: '26px', flex: '0 0 auto', margin: 0, padding: 0, borderRadius: '999px', cursor: 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                border: `1.5px solid ${AKARI_INK}`, background: 'transparent', color: AKARI_INK
                            }}>
                            <Codicon name='info' size={14} />
                        </button>
                    </div>
                    <div data-akari-info-license style={{ padding: '2px 16px 12px', color: MUTED, fontSize: '11.5px' }}>{model.license.name}</div>
                    <div style={{ borderTop: AKARI_BORDER.hairline }} />
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '12px 16px 4px' }}>
                        {keywords.map(keyword => <span key={keyword} data-akari-info-keyword style={{
                            padding: '3px 10px', borderRadius: '999px', border: AKARI_BORDER.hairline, background: AKARI_SURFACE.card,
                            color: AKARI_INK, fontSize: '11.5px', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                        }}>{keyword}</span>)}
                    </div>
                    {model.keywords.length > LIBRARY_INFO_KEYWORD_LIMIT
                        ? <button type='button' data-akari-info-keywords-all data-akari-library-link onClick={props.onToggleKeywords}
                            style={{ display: 'block', margin: 0, padding: '4px 16px 12px', border: 'none', background: 'transparent',
                                color: ACCENT_LIGHT, cursor: 'pointer', fontSize: '11.5px', fontFamily: 'inherit' }}>
                            {props.keywordsExpanded ? 'キーワードをたたむ' : 'すべてのキーワードを表示'}
                        </button>
                        : <div style={{ height: '10px' }} />}
                    {model.actions.length > 0 && <>
                        <div style={{ borderTop: AKARI_BORDER.hairline }} />
                        <div data-akari-info-actions style={{ display: 'flex', gap: '6px', padding: '12px 16px 14px', flexWrap: 'wrap' }}>
                            {model.actions.map(action => <ActionButton key={action.id} action={action} favorite={props.favorite} onClick={() => props.onAction(action.id)} />)}
                        </div>
                    </>}
                </div>
            </div>
        </Portal>
    );
}

// --- ⓘ = ライセンスの窓 ------------------------------------------------------------------------

export interface LibraryLicenseDialogProps {
    sheet: LibraryLicenseSheet;
    onCopyCredit?(): void;
    onMore?(url: string): void;
    onClose(): void;
}

export function LibraryLicenseDialog(props: LibraryLicenseDialogProps): React.ReactElement {
    const { sheet } = props;
    useEscape(props.onClose);
    return (
        <Portal>
            <div data-akari-license-layer onMouseDown={event => { if (event.target === event.currentTarget) props.onClose(); }}
                style={{ position: 'fixed', inset: 0, zIndex: 9100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0, 0, 0, 0.5)' }}>
                <div role='dialog' aria-modal='true' aria-label={sheet.title} data-akari-license-dialog={sheet.kind}
                    style={{ ...floatingSurface, position: 'relative', width: 'min(460px, 92vw)', maxHeight: '88vh', overflow: 'auto', padding: '26px 26px 22px' }}>
                    <button type='button' data-akari-license-close aria-label='閉じる' title='閉じる' onClick={props.onClose}
                        style={{
                            position: 'absolute', right: '14px', top: '14px', width: '30px', height: '30px', margin: 0, padding: 0,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '999px', cursor: 'pointer',
                            border: AKARI_BORDER.hairline, background: AKARI_SURFACE.elevated, color: AKARI_INK
                        }}>
                        <Codicon name='close' size={15} />
                    </button>
                    <div style={{
                        width: '38px', height: '38px', borderRadius: '999px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        marginBottom: '14px', background: AKARI_SURFACE.elevated, border: AKARI_BORDER.hairline,
                        color: sheet.kind === 'premium' ? ACCENT_LIGHT : AKARI_INK
                    }}>
                        {sheet.kind === 'premium' ? <CrownIcon size={18} /> : <Codicon name='law' size={18} />}
                    </div>
                    <h2 style={{ margin: '0 0 8px', fontSize: '20px', fontWeight: 900, lineHeight: 1.3 }}>{sheet.title}</h2>
                    <p style={{ margin: '0 0 18px', color: MUTED, fontSize: '13px', lineHeight: 1.6 }}>{sheet.lead}</p>
                    <h4 style={{ margin: '0 0 10px', fontSize: '12.5px', fontWeight: 700 }}>ライセンス権限の内容：</h4>
                    <ul style={{ listStyle: 'none', margin: '0 0 14px', padding: 0 }}>
                        {sheet.items.map((row, index) => (
                            <li key={index} data-akari-license-item={row.mark}
                                style={{ display: 'grid', gridTemplateColumns: '20px 1fr', gap: '10px', margin: '0 0 11px', fontSize: '13px', lineHeight: 1.6 }}>
                                <MarkIcon mark={row.mark} />
                                <span>{row.text}</span>
                            </li>
                        ))}
                    </ul>
                    {sheet.moreUrl
                        ? <button type='button' data-akari-license-more data-akari-library-link onClick={() => props.onMore?.(sheet.moreUrl!)}
                            style={{ display: 'block', margin: '0 0 18px 30px', padding: 0, border: 'none', background: 'transparent', color: AKARI_INK,
                                textDecoration: 'underline', cursor: 'pointer', fontSize: '12.5px', fontFamily: 'inherit', textAlign: 'left' }}>
                            このライセンスについて詳しくはこちら（{sheet.name}）
                        </button>
                        : <div data-akari-license-name style={{ margin: '0 0 18px 30px', color: MUTED, fontSize: '12px' }}>{sheet.name}</div>}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {sheet.credit && props.onCopyCredit && <button type='button' data-akari-license-credit onClick={props.onCopyCredit}
                            style={{
                                width: '100%', height: '36px', margin: 0, borderRadius: `${AKARI_RADIUS.panel}px`, cursor: 'pointer',
                                border: AKARI_BORDER.hairline, background: AKARI_SURFACE.elevated, color: AKARI_INK, fontSize: '12.5px', fontFamily: 'inherit',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
                            }}>
                            <Codicon name='copy' size={13} />クレジットをコピー
                        </button>}
                        <button type='button' data-akari-license-close onClick={props.onClose}
                            style={{
                                width: '100%', height: '38px', margin: 0, borderRadius: `${AKARI_RADIUS.panel}px`, cursor: 'pointer',
                                border: '1px solid transparent', background: ACCENT, color: 'var(--akari-bg)', fontWeight: 800, fontSize: '13.5px', fontFamily: 'inherit'
                            }}>閉じる</button>
                    </div>
                </div>
            </div>
        </Portal>
    );
}

// --- プレミアムの促しのシート ------------------------------------------------------------------

export interface LibraryPremiumSheetProps {
    title: string;
    body: string;
    actionLabel: string;
    onLab(): void;
    onClose(): void;
}

export function LibraryPremiumSheet(props: LibraryPremiumSheetProps): React.ReactElement {
    useEscape(props.onClose);
    return (
        <Portal>
            <div data-akari-premium-layer onMouseDown={event => { if (event.target === event.currentTarget) props.onClose(); }}
                style={{ position: 'fixed', inset: 0, zIndex: 9200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0, 0, 0, 0.5)' }}>
                <div role='dialog' aria-modal='true' aria-label={props.title} data-akari-premium-prompt
                    style={{ ...floatingSurface, width: 'min(420px, 92vw)', padding: '20px 22px 18px' }}>
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                        <span aria-hidden='true' style={{
                            width: '36px', height: '36px', flex: '0 0 auto', borderRadius: '999px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: AKARI_SURFACE.elevated, border: AKARI_BORDER.hairline, color: ACCENT_LIGHT
                        }}><CrownIcon size={18} /></span>
                        <div style={{ minWidth: 0 }}>
                            <h3 style={{ margin: '4px 0 8px', fontSize: '15px', fontWeight: 800, lineHeight: 1.4 }}>{props.title}</h3>
                            <p style={{ margin: 0, color: MUTED, fontSize: '12.5px', lineHeight: 1.65 }}>{props.body}</p>
                        </div>
                    </div>
                    <div style={{ margin: '14px 0 0', padding: '7px 10px', borderRadius: `${AKARI_RADIUS.panel}px`, background: AKARI_SURFACE.card,
                        border: AKARI_BORDER.hairline, color: MUTED, fontSize: '11.5px' }}>
                        検索の右の絞り込みで「料金 › 無料」を選ぶと、無料の素材だけを表示できます
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
                        <button type='button' data-akari-premium-close onClick={props.onClose}
                            style={{ height: '32px', padding: '0 14px', margin: 0, borderRadius: `${AKARI_RADIUS.panel}px`, cursor: 'pointer', fontFamily: 'inherit',
                                border: AKARI_BORDER.hairline, background: AKARI_SURFACE.elevated, color: AKARI_INK, fontSize: '12.5px' }}>閉じる</button>
                        <button type='button' data-akari-premium-lab onClick={props.onLab}
                            style={{ height: '32px', padding: '0 14px', margin: 0, borderRadius: `${AKARI_RADIUS.panel}px`, cursor: 'pointer', fontFamily: 'inherit',
                                border: '1px solid transparent', background: ACCENT, color: 'var(--akari-bg)', fontWeight: 800, fontSize: '12.5px',
                                display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {props.actionLabel}<Codicon name='link-external' size={12} />
                        </button>
                    </div>
                </div>
            </div>
        </Portal>
    );
}

// --- 検索の右のフィルター ----------------------------------------------------------------------

export interface LibraryFilterButtonProps {
    filter: LibraryFilterState;
    open: boolean;
    onToggle(): void;
}

export function LibraryFilterButton(props: LibraryFilterButtonProps): React.ReactElement {
    const count = libraryFilterCount(props.filter);
    const active = count > 0;
    return (
        <button type='button' data-akari-library-filter-button aria-haspopup='dialog' aria-expanded={props.open ? 'true' : 'false'}
            aria-label={active ? `絞り込み（${count} 件の条件）` : '絞り込み'} title='絞り込み（出どころ・料金・ライセンス・状態）'
            onClick={event => { event.stopPropagation(); props.onToggle(); }}
            style={{
                position: 'relative', flex: '0 0 auto', width: '30px', margin: 0, padding: 0, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: `${AKARI_RADIUS.panel}px`, background: active || props.open ? AKARI_SURFACE.elevated : AKARI_SURFACE.raised,
                border: active || props.open ? AKARI_BORDER.accent : AKARI_BORDER.hairline,
                color: active ? ACCENT_LIGHT : AKARI_INK
            }}>
            <Codicon name={active ? 'filter-filled' : 'filter'} size={14} />
            {active && <span data-akari-library-filter-count style={{
                position: 'absolute', right: '-6px', top: '-6px', minWidth: '16px', height: '16px', padding: '0 4px', boxSizing: 'border-box',
                borderRadius: '999px', background: ACCENT, color: 'var(--akari-bg)', fontSize: '10px', fontWeight: 800, lineHeight: '16px', textAlign: 'center'
            }}>{count}</span>}
        </button>
    );
}

export interface LibraryFilterPopoverProps {
    filter: LibraryFilterState;
    anchor: DOMRect;
    onToggleOption(section: LibraryFilterSectionKey, option: string): void;
    onClear(): void;
    onClose(): void;
}

const POPOVER_WIDTH = 272;

export function LibraryFilterPopover(props: LibraryFilterPopoverProps): React.ReactElement {
    useEscape(props.onClose);
    const left = Math.max(8, Math.min(window.innerWidth - POPOVER_WIDTH - 8, props.anchor.right - POPOVER_WIDTH));
    return (
        <Portal>
            <div data-akari-library-filter-layer onMouseDown={event => { if (event.target === event.currentTarget) props.onClose(); }}
                style={{ position: 'fixed', inset: 0, zIndex: 9000 }}>
                <div role='dialog' aria-label='絞り込み' data-akari-library-filter-popover onMouseDown={event => event.stopPropagation()}
                    style={{ ...floatingSurface, position: 'fixed', left: `${left}px`, top: `${props.anchor.bottom + 6}px`, width: `${POPOVER_WIDTH}px`, padding: '6px 12px 10px' }}>
                    {LIBRARY_FILTER_SECTIONS.map(section => (
                        <div key={section.key} data-akari-filter-section={section.key}>
                            <div style={{ padding: '10px 0 6px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.06em', color: MUTED }}>{section.label}</div>
                            <div role={section.single ? 'radiogroup' : 'group'} aria-label={section.label} style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                                {section.options.map(option => {
                                    const on = isLibraryFilterOptionOn(props.filter, section.key, option.key);
                                    return (
                                        <button key={option.key} type='button' data-akari-library-chip data-akari-filter-option={`${section.key}:${option.key}`}
                                            role={section.single ? 'radio' : undefined}
                                            aria-checked={section.single ? on : undefined} aria-pressed={section.single ? undefined : on}
                                            onClick={() => props.onToggleOption(section.key, option.key)}
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: '4px', margin: 0, padding: '3px 10px', borderRadius: '999px',
                                                cursor: 'pointer', fontSize: '11.5px', fontFamily: 'inherit',
                                                border: on ? `1px solid ${ACCENT_LIGHT}` : AKARI_BORDER.hairline,
                                                background: on ? AKARI_SURFACE.elevated : AKARI_SURFACE.card,
                                                color: on ? ACCENT_LIGHT : AKARI_INK, fontWeight: on ? 700 : 400
                                            }}>
                                            {section.key === 'price' && option.key === 'premium' && <CrownIcon size={11} />}
                                            {section.key === 'status' && option.key === 'favorite' && <Codicon name='star-full' size={11} />}
                                            {option.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginTop: '12px', paddingTop: '9px', borderTop: `1px solid ${AKARI_LINE.hairline}` }}>
                        <span style={{ color: AKARI_FAINT, fontSize: '10.5px' }}>タグは出しません（検索語には効きます）</span>
                        <button type='button' data-akari-filter-clear onClick={props.onClear}
                            style={{ margin: 0, padding: 0, border: 'none', background: 'transparent', color: ACCENT_LIGHT, cursor: 'pointer', fontSize: '11.5px', fontFamily: 'inherit' }}>
                            クリア
                        </button>
                    </div>
                </div>
            </div>
        </Portal>
    );
}
