/**
 * 出力プレビューの上のバー・要素の上の小さなメニューの「何を出すか」を決める純関数。
 * 状態（選んだ item・種類）は akari-annotations が `akari.contextBar.state` で配る（拡張をまたぐので型は複製）。
 * 値の正本は edit.json（タイムラインの文書）で、ここは表示用に読むだけ。
 */

export type ContextBarKind = 'shape' | 'line' | 'photo' | 'text' | 'canvas' | 'other';

export interface ContextBarState {
    editUri: string;
    selectedId: string | null;
    kind: ContextBarKind | null;
    item: Record<string, any> | null;
    sourcePath: string | null;
    parentId: string | null;
    locked: boolean;
    hasCorners: boolean;
    multi: number;
    styleCopy: ContextBarKind | null;
    output: { width: number; height: number };
    lockedIds: string[];
}

/** 配置の窓のレイヤー一覧（akari-annotations の layerListAt の形を複製）。 */
export interface ContextLayerRow {
    id: string;
    name: string;
    kind: ContextBarKind;
    start: number;
    end: number;
    locked: boolean;
    hidden: boolean;
    selected: boolean;
}

export interface ContextLayerList {
    parent: { id: string; name: string } | null;
    rows: ContextLayerRow[];
}

export function parseContextBarState(value: unknown): ContextBarState | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const state = value as Partial<ContextBarState>;
    if (typeof state.editUri !== 'string') return undefined;
    return {
        editUri: state.editUri,
        selectedId: typeof state.selectedId === 'string' ? state.selectedId : null,
        kind: typeof state.kind === 'string' ? state.kind : null,
        item: state.item && typeof state.item === 'object' ? state.item : null,
        sourcePath: typeof state.sourcePath === 'string' ? state.sourcePath : null,
        parentId: typeof state.parentId === 'string' ? state.parentId : null,
        locked: state.locked === true,
        hasCorners: state.hasCorners === true,
        multi: Number(state.multi) || 0,
        styleCopy: typeof state.styleCopy === 'string' ? state.styleCopy : null,
        output: { width: Number(state.output?.width) || 1920, height: Number(state.output?.height) || 1080 },
        lockedIds: Array.isArray(state.lockedIds) ? state.lockedIds.filter((id): id is string => typeof id === 'string') : []
    };
}

/**
 * バーの 1 項目。
 * - `color`: 色の丸（押すとインスペクターの色パネル）
 * - `window`: 押すと下に小さな窓が開く
 * - `inspector`: インスペクターの該当の場所へ飛ぶ（バーはインスペクターの近道）
 * - `action`: その場で実行（スタイルをコピー）
 */
export interface BarItem {
    key: string;
    label: string;
    kind: 'color' | 'window' | 'inspector' | 'action' | 'separator';
    /** 色の丸の塗り（CSS）。'none' は透明の印。 */
    paint?: string;
    /** 文字も出す項目（アニメーション・配置・編集…）。 */
    text?: boolean;
    disabled?: boolean;
    title?: string;
    /** color: 色パネルの対象のパス / inspector: 飛ぶ先。 */
    path?: string;
    allowTransparent?: boolean;
    inspector?: { tabId?: string; sectionId?: string; fieldName?: string };
}

const SEP: BarItem = { key: 'sep', label: '', kind: 'separator' };

/** 塗りの値（#RRGGBB(AA) / none / グラデーション）を丸に塗る CSS へ。 */
export function paintCss(value: unknown): string {
    if (value === undefined || value === null || value === '' || value === 'none' || value === 'transparent') return 'none';
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object') {
        const gradient = value as { type?: string; angle?: number; stops?: Array<{ color?: string; offset?: number }> };
        const stops = (gradient.stops ?? []).filter(stop => typeof stop.color === 'string')
            .map(stop => `${stop.color} ${Math.round((Number(stop.offset) || 0) * 100)}%`).join(', ');
        if (!stops) return 'none';
        return gradient.type === 'radial' ? `radial-gradient(circle, ${stops})`
            : `linear-gradient(${(Number(gradient.angle) || 0) + 90}deg, ${stops})`;
    }
    return 'none';
}

function params(state: ContextBarState): Record<string, any> {
    const source = state.item?.source;
    return source && typeof source === 'object' && source.params && typeof source.params === 'object' ? source.params : {};
}

/** 選んだものの種類で変わる、上のバーの項目。 */
export function barItems(state: ContextBarState): BarItem[] {
    if (!state.selectedId || !state.kind) return [];
    const p = params(state);
    const common = (withStyle = false): BarItem[] => [
        { key: 'opacity', label: '不透明度', kind: 'window' },
        SEP,
        { key: 'anim', label: 'アニメーション', kind: 'inspector', text: true, inspector: { tabId: 'video', sectionId: 'motion' } },
        { key: 'arrange', label: '配置', kind: 'window', text: true },
        ...(withStyle ? [SEP, { key: 'style', label: 'スタイルをコピー', kind: 'action' as const, title: 'スタイルをコピー（⌥⌘C）' }] : [])
    ];
    if (state.kind === 'shape') {
        const closedFill = state.item?.source?.shape !== 'line';
        const strokeWidth = Number(p.strokeWidth) || 0;
        return [
            ...(closedFill ? [{ key: 'fill', label: '塗りの色', kind: 'color' as const, paint: paintCss(p.fill), path: 'source.params.fill', allowTransparent: true }] : []),
            { key: 'stroke', label: '枠の色', kind: 'color', paint: strokeWidth > 0 ? paintCss(p.stroke) : 'none', path: 'source.params.stroke' },
            { key: 'weight', label: '枠線の太さ', kind: 'window' },
            ...(state.hasCorners ? [{ key: 'radius', label: '角の丸み', kind: 'window' as const }] : []),
            ...common()
        ];
    }
    if (state.kind === 'line') {
        return [
            { key: 'stroke', label: '線の色', kind: 'color', paint: paintCss(p.stroke ?? '#000000'), path: 'source.params.stroke' },
            { key: 'weight', label: '太さ', kind: 'window' },
            { key: 'dash', label: '線の種類', kind: 'window' },
            { key: 'ends', label: '始点と終点', kind: 'window' },
            ...common()
        ];
    }
    if (state.kind === 'photo') {
        const soon = 'この道具は準備中です';
        return [
            { key: 'edit', label: '編集', kind: 'inspector', text: true, inspector: { tabId: 'video', sectionId: 'appearance' } },
            SEP,
            { key: 'replace', label: '置き換え', kind: 'action', text: true },
            { key: 'cutout', label: '背景透過', kind: 'inspector', text: true, inspector: { tabId: 'video', sectionId: 'appearance', fieldName: 'photo-mask-generate' } },
            { key: 'eraser', label: '消しゴム', kind: 'inspector', text: true, inspector: { tabId: 'video', sectionId: 'appearance', fieldName: 'photo-brush-start' } },
            { key: 'photoColor', label: '写真の色', kind: 'inspector', text: true, inspector: { tabId: 'adjust' } },
            { key: 'border', label: '枠線', kind: 'inspector', text: true, disabled: true, title: soon },
            { key: 'photoRadius', label: '角の丸み', kind: 'inspector', text: true, disabled: true, title: soon },
            { key: 'crop', label: '切り抜き', kind: 'inspector', text: true, inspector: { tabId: 'video', sectionId: 'crop' } },
            { key: 'flip', label: '反転', kind: 'window', text: true },
            ...common(true)
        ];
    }
    return common(state.kind !== 'canvas');
}

export const DASH_OPTIONS = [
    { value: 'solid', label: '実線' },
    { value: 'dash', label: '破線' },
    { value: 'dot', label: '点線' }
] as const;

export const CAP_OPTIONS = [
    { value: 'none', label: 'なし' },
    { value: 'triangle', label: '三角' },
    { value: 'chevron', label: '矢印' },
    { value: 'bar', label: '縦線' },
    { value: 'square', label: '四角' },
    { value: 'circle', label: '丸' },
    { value: 'diamond', label: 'ひし形' }
] as const;

/** 窓に出す今の値（0〜100 の目盛り）。 */
export function windowValues(state: ContextBarState): {
    opacity: number; weight: number; weightMin: number; radius: number; dash: string; round: boolean;
    startCap: string; endCap: string; flipH: boolean; flipV: boolean;
} {
    const p = params(state);
    const item = state.item ?? {};
    const opacity = typeof item.opacity === 'number' ? item.opacity : 1;
    const line = state.kind === 'line';
    return {
        opacity: Math.round(opacity * 100),
        weight: Math.round(Number(p.strokeWidth ?? (line ? 8 : 0)) || 0),
        weightMin: line ? 1 : 0,
        radius: Math.round(Number(p.cornerRadius) || 0),
        dash: typeof p.dash === 'string' ? p.dash : 'solid',
        round: p.lineCap === 'round',
        startCap: typeof p.startCap === 'string' ? p.startCap : 'none',
        endCap: typeof p.endCap === 'string' ? p.endCap : (state.item?.source?.shape === 'arrow' ? 'triangle' : 'none'),
        flipH: item.flip?.h === true,
        flipV: item.flip?.v === true
    };
}

/** 配置の窓の数値（インスペクターと同じ値: X / Y = transform.x / y・回転。幅 / 高さは図形の見えている px）。 */
export function geometryValues(state: ContextBarState): {
    x: number; y: number; rotate: number; width?: number; height?: number;
} {
    const t = state.item?.transform ?? {};
    const scale = typeof t.scale === 'number' ? t.scale : 1;
    const sx = typeof t.scaleX === 'number' ? t.scaleX : scale;
    const sy = typeof t.scaleY === 'number' ? t.scaleY : scale;
    const p = params(state);
    const shape = state.item?.source?.kind === 'shape';
    const baseW = Number(p.width) || 600;
    const baseH = Number(p.height) || (state.item?.source?.shape === 'line' ? 80 : 340);
    return {
        x: round1(Number(t.x) || 0), y: round1(Number(t.y) || 0), rotate: round1(Number(t.rotate) || 0),
        ...(shape ? { width: round1(baseW * sx), height: round1(baseH * sy) } : {})
    };
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

/**
 * 画面に揃える: 見えている箱（出力の px）を画面の端・中央へ動かす量。
 * 箱はプレビューで測ったもの（回転していれば外接の箱）。
 */
export function alignDelta(box: { x: number; y: number; width: number; height: number },
    output: { width: number; height: number }, mode: AlignMode): { dx: number; dy: number } {
    switch (mode) {
        case 'left': return { dx: -box.x, dy: 0 };
        case 'center': return { dx: output.width / 2 - (box.x + box.width / 2), dy: 0 };
        case 'right': return { dx: output.width - (box.x + box.width), dy: 0 };
        case 'top': return { dx: 0, dy: -box.y };
        case 'middle': return { dx: 0, dy: output.height / 2 - (box.y + box.height / 2) };
        case 'bottom': return { dx: 0, dy: output.height - (box.y + box.height) };
    }
}

/** レイヤー一覧の時間の範囲（0:01.0–0:06.0）。 */
export function formatRange(start: number, end: number): string {
    const stamp = (seconds: number): string => {
        const value = Math.max(0, Math.round(seconds * 10) / 10);
        return `${Math.floor(value / 60)}:${(value % 60).toFixed(1).padStart(4, '0')}`;
    };
    return `${stamp(start)}–${stamp(end)}`;
}

/**
 * 小さなメニューの置き場所（ホストの座標）。選んだ箱の上に 8px 空けて中央。上のバーとぶつかる・上が切れるときは、
 * 箱の下（回転 / 移動ボタンの下）へ回す。
 */
export function elementMenuPosition(box: { left: number; top: number; width: number; height: number },
    menu: { width: number; height: number }, area: { left: number; top: number; width: number; height: number },
    avoidBottom: number): { left: number; top: number; placement: 'above' | 'below' } {
    const center = box.left + box.width / 2;
    const left = Math.max(area.left + 4, Math.min(center - menu.width / 2, area.left + area.width - menu.width - 4));
    const above = box.top - 10 - menu.height;
    if (above >= Math.max(area.top + 4, avoidBottom + 4)) return { left, top: above, placement: 'above' };
    const below = box.top + box.height + 52;
    return { left, top: Math.min(below, area.top + area.height - menu.height - 4), placement: 'below' };
}

/** ⌘ / Ctrl の表記。 */
export function shortcutLabel(key: string, options: { mac: boolean; alt?: boolean }): string {
    if (key === 'Delete') return 'DELETE';
    return options.mac ? `${options.alt ? '⌥' : ''}⌘${key}` : `Ctrl+${options.alt ? 'Alt+' : ''}${key}`;
}
