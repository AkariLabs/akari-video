/**
 * 図形の棚の組み立て（行・すべて表示・最近使用・検索）の純関数。
 *
 * 棚の中身は `presets/shapes/index.jsonl`（図形の契約 v1 §3）。1 行 = 1 件で、行の並びは
 * jsonl に現れたカテゴリの順をそのまま使い、先頭に「最近使用した項目」と「ライン」を置く。
 * 名前はタイルに出さず、ツールチップと検索だけに使う。DOM に依存しないので node --test で検証する。
 */

export type ShapeShelfKind = 'fill' | 'stroke' | 'line' | 'bubble';

/** index.jsonl の 1 行。`defaults` は置くときに値で写す（参照し続けない）。 */
export interface ShapeShelfPreset {
    readonly id: string;
    readonly category: string;
    readonly name: string;
    readonly vb: readonly [number, number];
    readonly d: string;
    readonly kind: ShapeShelfKind;
    readonly rule?: 'nonzero' | 'evenodd';
    readonly rounded_from?: { readonly base: string; readonly radius: number };
    readonly defaults: Readonly<Record<string, unknown>>;
}

export interface ShapeShelfRow {
    readonly key: string;
    readonly label: string;
    /** 棚の 1 行に並べる分。全部は「すべて表示」で出す。 */
    readonly items: readonly ShapeShelfPreset[];
    readonly total: number;
}

export const SHAPE_SHELF_RECENT_KEY = 'recent';
export const SHAPE_SHELF_LINE_KEY = 'line';
export const SHAPE_SHELF_RECENT_STORAGE_KEY = 'akari.library.shapes.recent';
/** 保存する最近使用の件数。棚の行にはそのうち先頭 SHAPE_SHELF_RECENT_ROW_LIMIT 件だけを出す。 */
export const SHAPE_SHELF_RECENT_LIMIT = 20;
export const SHAPE_SHELF_RECENT_ROW_LIMIT = 12;
export const SHAPE_SHELF_ROW_LIMIT = 14;

export const SHAPE_SHELF_CATEGORY_LABELS: Readonly<Record<string, string>> = {
    [SHAPE_SHELF_RECENT_KEY]: '最近使用した項目',
    line: 'ライン',
    basic: '基本の図形',
    polygon: '多角形',
    star: 'スター',
    arrow: '矢印',
    flow: 'フローチャート',
    bubble: '吹き出し',
    cloud: '雲',
    heart: 'ハート',
    banner: '横断幕・垂れ幕',
    drop: '雫',
    gear: '歯車',
    asterisk: '四角い星・アスタリスク',
    organic: '有機的',
    wave: '波線',
    abstract: '抽象的',
    manga: '漫画の吹き出し'
};

/** 棚の「ライン」行に出す 15 本（線種 3 × よく使う端の組）。全 45 本は「すべて表示」。 */
export const SHAPE_SHELF_LINE_ROW: readonly string[] = [
    'line-solid-none-none', 'line-dash-none-none', 'line-dot-none-none',
    'line-solid-none-tri', 'line-solid-none-open', 'line-dot-none-open',
    'line-solid-bar-bar', 'line-solid-open-open', 'line-dot-tri-tri',
    'line-solid-sq-sq', 'line-solid-circ-circ', 'line-solid-dia-dia',
    'line-solid-sqo-sqo', 'line-solid-circo-circo', 'line-solid-diao-diao'
];

const KINDS: readonly ShapeShelfKind[] = ['fill', 'stroke', 'line', 'bubble'];

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** 1 行を棚の型へ絞り込む。壊れた行は捨てる（棚全体を落とさない）。 */
export function parseShapeShelfPreset(value: unknown): ShapeShelfPreset | undefined {
    if (!isRecord(value)) return undefined;
    const { id, category, name, vb, d, kind, rule, rounded_from: roundedFrom, defaults } = value;
    if (typeof id !== 'string' || !id || typeof category !== 'string' || !category
        || typeof name !== 'string' || !name || typeof d !== 'string' || !d
        || !KINDS.includes(kind as ShapeShelfKind) || !isRecord(defaults)
        || !Array.isArray(vb) || vb.length !== 2
        || !vb.every(side => typeof side === 'number' && Number.isFinite(side) && side > 0)) return undefined;
    return {
        id, category, name, d, kind: kind as ShapeShelfKind, defaults,
        vb: [vb[0] as number, vb[1] as number],
        ...(rule === 'nonzero' || rule === 'evenodd' ? { rule } : {}),
        ...(isRecord(roundedFrom) && typeof roundedFrom.base === 'string' && typeof roundedFrom.radius === 'number'
            ? { rounded_from: { base: roundedFrom.base, radius: roundedFrom.radius } } : {})
    };
}

export function parseShapeShelfJsonl(raw: string): ShapeShelfPreset[] {
    const seen = new Set<string>();
    const presets: ShapeShelfPreset[] = [];
    for (const line of raw.split(/\r?\n/)) {
        if (!line.trim()) continue;
        let decoded: unknown;
        try { decoded = JSON.parse(line); } catch { continue; }
        const preset = parseShapeShelfPreset(decoded);
        if (!preset || seen.has(preset.id)) continue;
        seen.add(preset.id);
        presets.push(preset);
    }
    return presets;
}

export function shapeShelfRowLabel(key: string): string {
    return SHAPE_SHELF_CATEGORY_LABELS[key] ?? key;
}

/** jsonl に現れた順のカテゴリ（ラインを除く）。 */
function shapeCategories(presets: readonly ShapeShelfPreset[]): string[] {
    const categories: string[] = [];
    for (const preset of presets) {
        if (preset.kind === 'line' || categories.includes(preset.category)) continue;
        categories.push(preset.category);
    }
    return categories;
}

function resolveIds(presets: readonly ShapeShelfPreset[], ids: readonly string[]): ShapeShelfPreset[] {
    const byId = new Map(presets.map(preset => [preset.id, preset]));
    return ids.flatMap(id => {
        const preset = byId.get(id);
        return preset ? [preset] : [];
    });
}

/** その行の全件（「すべて表示」の中身）。 */
export function shapeShelfRowItems(
    presets: readonly ShapeShelfPreset[], key: string, recentIds: readonly string[]
): ShapeShelfPreset[] {
    if (key === SHAPE_SHELF_RECENT_KEY) return resolveIds(presets, recentIds);
    if (key === SHAPE_SHELF_LINE_KEY) return presets.filter(preset => preset.kind === 'line');
    return presets.filter(preset => preset.kind !== 'line' && preset.category === key);
}

/** 棚の行: 最近使用（あるときだけ）→ ライン → jsonl のカテゴリ順。 */
export function buildShapeShelfRows(
    presets: readonly ShapeShelfPreset[], recentIds: readonly string[]
): ShapeShelfRow[] {
    const rows: ShapeShelfRow[] = [];
    const recent = shapeShelfRowItems(presets, SHAPE_SHELF_RECENT_KEY, recentIds);
    if (recent.length) {
        rows.push({
            key: SHAPE_SHELF_RECENT_KEY, label: shapeShelfRowLabel(SHAPE_SHELF_RECENT_KEY),
            items: recent.slice(0, SHAPE_SHELF_RECENT_ROW_LIMIT), total: recent.length
        });
    }
    const lines = shapeShelfRowItems(presets, SHAPE_SHELF_LINE_KEY, recentIds);
    if (lines.length) {
        const featured = resolveIds(lines, SHAPE_SHELF_LINE_ROW);
        rows.push({
            key: SHAPE_SHELF_LINE_KEY, label: shapeShelfRowLabel(SHAPE_SHELF_LINE_KEY),
            items: featured.length ? featured : lines.slice(0, SHAPE_SHELF_ROW_LIMIT), total: lines.length
        });
    }
    for (const category of shapeCategories(presets)) {
        const items = shapeShelfRowItems(presets, category, recentIds);
        rows.push({ key: category, label: shapeShelfRowLabel(category), items: items.slice(0, SHAPE_SHELF_ROW_LIMIT), total: items.length });
    }
    return rows;
}

function normalizeQuery(value: string): string {
    return value.normalize('NFKC').trim().toLowerCase();
}

/** 図形の名前（とその行の名前）で引く。ID は画面に出ない語なので対象にしない。 */
export function searchShapeShelf(presets: readonly ShapeShelfPreset[], query: string): ShapeShelfPreset[] {
    const normalized = normalizeQuery(query);
    if (!normalized) return [];
    return presets.filter(preset => normalizeQuery(`${preset.name} ${shapeShelfRowLabel(preset.kind === 'line' ? SHAPE_SHELF_LINE_KEY : preset.category)}`)
        .includes(normalized));
}

/** 置いた順（新しいものが先頭）。同じ図形は先頭へ移して重複させない。 */
export function pushRecentShape(recent: readonly string[], id: string, limit = SHAPE_SHELF_RECENT_LIMIT): string[] {
    if (!id) return [...recent];
    return [id, ...recent.filter(candidate => candidate !== id)].slice(0, limit);
}

export function parseRecentShapes(raw: string | null | undefined): string[] {
    if (!raw) return [];
    try {
        const decoded: unknown = JSON.parse(raw);
        if (!Array.isArray(decoded)) return [];
        return [...new Set(decoded.filter((id): id is string => typeof id === 'string' && id.length > 0))]
            .slice(0, SHAPE_SHELF_RECENT_LIMIT);
    } catch {
        return [];
    }
}

/** ドラッグの payload。受け側（タイムライン・プレビュー）は preset だけを信じ、形はコマンドで引き直す。 */
export interface ShapeShelfDragPayload {
    readonly kind: 'shape';
    readonly preset: string;
    readonly name: string;
    /** 仮枠の縦横比のため。 */
    readonly vb: readonly [number, number];
}

export function shapeShelfDragPayload(preset: ShapeShelfPreset): ShapeShelfDragPayload {
    return { kind: 'shape', preset: preset.id, name: preset.name, vb: [preset.vb[0], preset.vb[1]] };
}
