/**
 * 色パネルの値と計算（DOM を持たない純関数）。
 *
 * 値の形は図形の塗り・枠の契約と同じ:
 *   - 単色 = `#RRGGBB` か `#RRGGBBAA`（大文字にそろえる。AA = FF は落とす）
 *   - 透明 = `'none'`（塗りだけ。中抜き）
 *   - グラデーション = `{ type: 'linear', angle, stops }` / `{ type: 'radial', stops }`
 *     stops = `[{ color: '#RRGGBB(AA)', offset: 0..1 }]`（2〜5 色。色ごとの透明度は color の AA）
 *     angle は CSS の linear-gradient と同じ向き（0 = 下から上・90 = 左から右・180 = 上から下）
 */

export interface GradientStop {
    color: string;
    offset: number;
}

export interface LinearGradientPaint {
    type: 'linear';
    angle: number;
    stops: GradientStop[];
}

export interface RadialGradientPaint {
    type: 'radial';
    stops: GradientStop[];
}

export type GradientPaint = LinearGradientPaint | RadialGradientPaint;
/** 単色（`#RRGGBB(AA)`）・透明（`'none'`）・グラデーション。 */
export type Paint = string | GradientPaint;

export const TRANSPARENT_PAINT = 'none';
export const GRADIENT_MIN_STOPS = 2;
export const GRADIENT_MAX_STOPS = 5;
export const COLOR_HISTORY_LIMIT = 8;

export interface HsvColor {
    /** 0..360 */
    h: number;
    /** 0..1 */
    s: number;
    /** 0..1 */
    v: number;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const hex2 = (value: number): string => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0').toUpperCase();

/** `#abc` / `abc` / `#aabbcc` / `#aabbccdd` → `#AABBCC(DD)`。不透明の AA は落とす。読めない値は undefined。 */
export function normalizeHex(input: unknown): string | undefined {
    if (typeof input !== 'string') return undefined;
    const match = /^#?([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/iu.exec(input.trim());
    if (!match) return undefined;
    let digits = match[1];
    if (digits.length <= 4) digits = digits.split('').map(char => char + char).join('');
    digits = digits.toUpperCase();
    if (digits.length === 8 && digits.endsWith('FF')) digits = digits.slice(0, 6);
    return `#${digits}`;
}

export function isGradientPaint(value: unknown): value is GradientPaint {
    return !!value && typeof value === 'object' && Array.isArray((value as { stops?: unknown }).stops)
        && ((value as { type?: unknown }).type === 'linear' || (value as { type?: unknown }).type === 'radial');
}

/** 色 1 つの透明度（0..1）。 */
export function alphaOf(color: string): number {
    const hex = normalizeHex(color);
    return hex && hex.length === 9 ? parseInt(hex.slice(7), 16) / 255 : 1;
}

/** AA を外した `#RRGGBB`。 */
export function opaqueHex(color: string): string {
    return (normalizeHex(color) ?? '#000000').slice(0, 7);
}

/** `#RRGGBB` に透明度（0..1）を付ける。1 なら AA を付けない。 */
export function withAlpha(color: string, alpha: number): string {
    const base = opaqueHex(color);
    const a = clamp(alpha, 0, 1);
    return a >= 0.999 ? base : `${base}${hex2(a * 255)}`;
}

export function hexToRgb(color: string): { r: number; g: number; b: number } {
    const n = parseInt(opaqueHex(color).slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex(r: number, g: number, b: number): string {
    return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

export function hexToHsv(color: string): HsvColor {
    const { r, g, b } = hexToRgb(color);
    const [rr, gg, bb] = [r / 255, g / 255, b / 255];
    const max = Math.max(rr, gg, bb);
    const min = Math.min(rr, gg, bb);
    const d = max - min;
    let h = 0;
    if (d) {
        h = max === rr ? ((gg - bb) / d) % 6 : max === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4;
        h *= 60;
        if (h < 0) h += 360;
    }
    return { h, s: max ? d / max : 0, v: max };
}

export function hsvToHex({ h, s, v }: HsvColor): string {
    const f = (n: number): number => {
        const k = (n + clamp(h, 0, 360) / 60) % 6;
        return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255;
    };
    return rgbToHex(f(5), f(3), f(1));
}

/** 均等な offset（0, 1/(n-1), …, 1）。 */
export function evenOffsets(count: number): number[] {
    if (count <= 1) return [0];
    return Array.from({ length: count }, (_, index) => Math.round(index / (count - 1) * 10000) / 10000);
}

function normalizeStops(stops: readonly unknown[]): GradientStop[] | undefined {
    if (stops.length < GRADIENT_MIN_STOPS || stops.length > GRADIENT_MAX_STOPS) return undefined;
    const offsets = evenOffsets(stops.length);
    const result: GradientStop[] = [];
    for (const [index, stop] of stops.entries()) {
        const raw = typeof stop === 'string' ? { color: stop, offset: offsets[index] } : stop as Partial<GradientStop> | null;
        const color = normalizeHex(raw?.color);
        const offset = typeof raw?.offset === 'number' && Number.isFinite(raw.offset) ? clamp(raw.offset, 0, 1) : offsets[index];
        if (!color) return undefined;
        result.push({ color, offset });
    }
    return result;
}

/** 保存値（edit.json・入力）を Paint として読む。読めない値は undefined。 */
export function parsePaint(value: unknown): Paint | undefined {
    if (value === TRANSPARENT_PAINT) return TRANSPARENT_PAINT;
    if (typeof value === 'string') return normalizeHex(value);
    if (!isGradientPaint(value)) return undefined;
    const stops = normalizeStops(value.stops);
    if (!stops) return undefined;
    if (value.type === 'radial') return { type: 'radial', stops };
    const angle = typeof (value as LinearGradientPaint).angle === 'number' && Number.isFinite((value as LinearGradientPaint).angle)
        ? (((value as LinearGradientPaint).angle % 360) + 360) % 360 : 90;
    return { type: 'linear', angle, stops };
}

/** 同じ色かを比べるための鍵（大文字・小文字や AA=FF の差を吸収）。 */
export function paintKey(paint: Paint | undefined): string {
    const parsed = parsePaint(paint);
    if (parsed === undefined) return '';
    if (typeof parsed === 'string') return parsed;
    return JSON.stringify(parsed.type === 'linear'
        ? { type: 'linear', angle: parsed.angle, stops: parsed.stops }
        : { type: 'radial', stops: parsed.stops });
}

export function samePaint(a: Paint | undefined, b: Paint | undefined): boolean {
    const key = paintKey(a);
    return key !== '' && key === paintKey(b);
}

/** CSS の background に置ける文字列。 */
export function paintToCss(paint: Paint | undefined): string {
    const parsed = parsePaint(paint);
    if (parsed === undefined || parsed === TRANSPARENT_PAINT) return 'transparent';
    if (typeof parsed === 'string') return parsed;
    const stops = parsed.stops.map(stop => `${stop.color} ${Math.round(stop.offset * 1000) / 10}%`).join(', ');
    return parsed.type === 'radial' ? `radial-gradient(circle, ${stops})` : `linear-gradient(${parsed.angle}deg, ${stops})`;
}

/** 色の丸の title に使う短い説明。 */
export function paintLabel(paint: Paint | undefined): string {
    const parsed = parsePaint(paint);
    if (parsed === undefined) return '';
    if (parsed === TRANSPARENT_PAINT) return '透明';
    if (typeof parsed === 'string') return parsed;
    return `グラデーション（${parsed.stops.map(stop => stop.color).join(' → ')}）`;
}

// ---- 既定の色 ----

export interface NamedColor {
    color: string;
    /** 検索に使う名前（先頭が見出しの名前）。 */
    names: string;
}

/** デフォルトの単色。先頭 28 色（4 段）が既定の表示、「すべて表示」で 42 色（6 段）。 */
export const DEFAULT_SOLID_COLORS: readonly NamedColor[] = ([
    ['#000000', '黒 くろ ブラック'], ['#545454', 'グレー 灰 はい 濃い'], ['#737373', 'グレー 灰 はい'], ['#A6A6A6', 'グレー 灰 はい'],
    ['#B4B4B4', 'グレー 灰 はい 薄い'], ['#D9D9D9', 'グレー 灰 はい 薄い'], ['#FFFFFF', '白 しろ ホワイト'],
    ['#FF3131', '赤 あか レッド'], ['#FF5757', '赤 あか 薄い'], ['#FF66C4', 'ピンク 桃 もも'], ['#E2A9F1', '紫 むらさき 薄い ラベンダー'],
    ['#CB6CE6', '紫 むらさき パープル'], ['#8C52FF', '紫 むらさき バイオレット'], ['#5E17EB', '紫 むらさき 濃い'],
    ['#0097B2', '青緑 あおみどり 青 あお ティール'], ['#0CC0DF', '水色 みずいろ 青 あお シアン'], ['#5CE1E6', '水色 みずいろ 青 あお 薄い'],
    ['#38B6FF', '空色 そらいろ 青 あお'], ['#5271FF', '青 あお ブルー'], ['#004AAD', '紺 こん 青 あお'], ['#1800AD', '紺 こん 青 あお 濃い'],
    ['#00BF63', '緑 みどり グリーン'], ['#7ED957', '黄緑 きみどり 緑 みどり'], ['#C1FF72', '黄緑 きみどり ライム'], ['#FFDE59', '黄 き 黄色 きいろ イエロー'],
    ['#FFBD59', '山吹 やまぶき 黄 き オレンジ'], ['#FF914D', 'オレンジ 橙 だいだい'], ['#FF751F', 'オレンジ 橙 だいだい 濃い'],
    ['#FFD6D6', 'ピンク 桃 もも 薄い パステル'], ['#FFE4F2', 'ピンク 桃 もも パステル'], ['#F3E5FF', '紫 むらさき パステル'],
    ['#E0ECFF', '青 あお パステル'], ['#DCFCE7', '緑 みどり パステル'], ['#FEF9C3', '黄 き 黄色 きいろ パステル'], ['#FFEDD5', 'オレンジ 橙 だいだい パステル'],
    ['#7F1D1D', '赤 あか 濃い 茶 ちゃ'], ['#831843', 'ピンク 桃 もも 濃い'], ['#4C1D95', '紫 むらさき 濃い'], ['#1E3A8A', '紺 こん 青 あお 濃い'],
    ['#064E3B', '緑 みどり 濃い'], ['#713F12', '茶 ちゃ 茶色 ちゃいろ ブラウン'], ['#7C2D12', '茶 ちゃ オレンジ 濃い']
] as const).map(([color, names]) => ({ color, names }));

export const DEFAULT_SOLID_COLLAPSED = 28;

const pair = (from: string, to: string, angle = 90): LinearGradientPaint =>
    ({ type: 'linear', angle, stops: [{ color: from, offset: 0 }, { color: to, offset: 1 }] });

/** デフォルトのグラデーション。先頭 21 種（3 段）が既定の表示、「すべて表示」で 35 種（5 段）。 */
export const DEFAULT_GRADIENTS: readonly GradientPaint[] = ([
    ['#000000', '#737373'], ['#000000', '#FFFFFF'], ['#A6A6A6', '#FFFFFF'], ['#7ED957', '#C9E265'], ['#000000', '#C89116'],
    ['#6A3F8E', '#F5D547', 180], ['#000000', '#3533CD'],
    ['#D9F7E9', '#A8C0FF'], ['#FF3131', '#FF914D'], ['#FF5757', '#8C52FF'], ['#5170FF', '#FF66C4'], ['#004AAD', '#CB6CE6'],
    ['#8C52FF', '#5CE1E6'], ['#5DE0E6', '#004AAD'],
    ['#8C52FF', '#00BF63'], ['#0097B2', '#7ED957'], ['#0CC0DF', '#FFDE59'], ['#FFDE59', '#FF914D'], ['#FF66C4', '#FFDE59'],
    ['#FFF7AD', '#FFA9F9'], ['#8C52FF', '#FF914D'],
    ['#1E3A8A', '#0EA5E9'], ['#F43F5E', '#F59E0B'], ['#10B981', '#3B82F6'], ['#111827', '#6B7280'], ['#FDE68A', '#FCA5A5'],
    ['#A78BFA', '#F472B6'], ['#22D3EE', '#A3E635'],
    ['#0F172A', '#7C3AED'], ['#FB7185', '#FDBA74'], ['#34D399', '#FEF08A'], ['#60A5FA', '#C084FC'], ['#F97316', '#7C2D12'],
    ['#E2E8F0', '#94A3B8'], ['#FF3131', '#5E17EB']
] as const).map(([from, to, angle]) => pair(from, to, angle));

export const DEFAULT_GRADIENT_COLLAPSED = 21;

export interface GradientStyle {
    id: 'horizontal' | 'vertical' | 'diagonal-down' | 'radial' | 'diagonal-up';
    label: string;
    type: 'linear' | 'radial';
    angle?: number;
}

/** 色を作る窓のスタイル 5 種（linear の角度 4 つ + radial）。 */
export const GRADIENT_STYLES: readonly GradientStyle[] = [
    { id: 'horizontal', label: '横', type: 'linear', angle: 90 },
    { id: 'vertical', label: '縦', type: 'linear', angle: 180 },
    { id: 'diagonal-down', label: '斜め ↘', type: 'linear', angle: 135 },
    { id: 'radial', label: '放射', type: 'radial' },
    { id: 'diagonal-up', label: '斜め ↗', type: 'linear', angle: 45 }
];

/** 今の値がどのスタイルか（無ければ -1）。 */
export function gradientStyleIndex(paint: Paint | undefined): number {
    const parsed = parsePaint(paint);
    if (!isGradientPaint(parsed)) return -1;
    return GRADIENT_STYLES.findIndex(style => style.type === parsed.type
        && (parsed.type === 'radial' || style.angle === parsed.angle));
}

/** 単色から始めるときの 2 色目。 */
export const GRADIENT_SECOND_COLOR = '#545454';

/** 今の値をグラデーションとして扱う（単色・透明なら 2 色の横グラデーションを作る）。 */
export function gradientFrom(paint: Paint | undefined): GradientPaint {
    const parsed = parsePaint(paint);
    if (isGradientPaint(parsed)) return parsed;
    const base = typeof parsed === 'string' && parsed !== TRANSPARENT_PAINT ? parsed : '#000000';
    return pair(base, GRADIENT_SECOND_COLOR);
}

export function applyGradientStyle(paint: Paint | undefined, index: number): GradientPaint {
    const style = GRADIENT_STYLES[index] ?? GRADIENT_STYLES[0];
    const stops = gradientFrom(paint).stops;
    return style.type === 'radial'
        ? { type: 'radial', stops }
        : { type: 'linear', angle: style.angle ?? 90, stops };
}

function withStops(gradient: GradientPaint, colors: readonly string[]): GradientPaint {
    const offsets = evenOffsets(colors.length);
    const stops = colors.map((color, index) => ({ color, offset: offsets[index] }));
    return gradient.type === 'radial' ? { type: 'radial', stops } : { type: 'linear', angle: gradient.angle, stops };
}

/** 色を 1 つ足す（最大 5 色・白を末尾へ・offset は均等に振り直す）。 */
export function addGradientStop(paint: Paint | undefined, color = '#FFFFFF'): GradientPaint {
    const gradient = gradientFrom(paint);
    if (gradient.stops.length >= GRADIENT_MAX_STOPS) return gradient;
    return withStops(gradient, [...gradient.stops.map(stop => stop.color), normalizeHex(color) ?? '#FFFFFF']);
}

/** n 色目を外す（2 色のときは外さない）。 */
export function removeGradientStop(paint: Paint | undefined, index: number): GradientPaint {
    const gradient = gradientFrom(paint);
    if (gradient.stops.length <= GRADIENT_MIN_STOPS || index < 0 || index >= gradient.stops.length) return gradient;
    return withStops(gradient, gradient.stops.filter((_, i) => i !== index).map(stop => stop.color));
}

/** n 色目の色（と透明度）を変える。alpha を省くと今の透明度を保つ。 */
export function setGradientStopColor(paint: Paint | undefined, index: number, color: string, alpha?: number): GradientPaint {
    const gradient = gradientFrom(paint);
    const old = gradient.stops[index];
    if (!old) return gradient;
    const stops = gradient.stops.map((stop, i) => i === index
        ? { color: withAlpha(color, alpha ?? alphaOf(old.color)), offset: stop.offset } : stop);
    return gradient.type === 'radial' ? { type: 'radial', stops } : { type: 'linear', angle: gradient.angle, stops };
}

// ---- 検索 ----

export interface ColorSearchResult {
    /** 色番号として読めたときの色。 */
    exact?: string;
    hits: NamedColor[];
}

/** 「青」のような色の名前か「#00c4cc」のような色番号で探す。 */
export function searchColors(query: string, palette: readonly NamedColor[] = DEFAULT_SOLID_COLORS): ColorSearchResult {
    const q = query.trim();
    if (!q) return { hits: [] };
    const exact = /^#?[0-9a-f]{3}$|^#?[0-9a-f]{6}$|^#?[0-9a-f]{8}$/iu.test(q) ? normalizeHex(q) : undefined;
    const lower = q.toLowerCase();
    const hexQuery = lower.replace(/^#/u, '');
    const hits = palette.filter(entry => entry.names.split(/\s+/u).some(name => name.includes(q))
        || (/^[0-9a-f]+$/u.test(hexQuery) && entry.color.toLowerCase().slice(1).startsWith(hexQuery)));
    return { exact, hits: hits.filter(entry => entry.color !== exact) };
}

// ---- 履歴 ----

/** 使った色を先頭へ（同じ色は前から外す・透明は積まない・最大 8）。 */
export function pushColorHistory(history: readonly Paint[], paint: Paint, limit = COLOR_HISTORY_LIMIT): Paint[] {
    const parsed = parsePaint(paint);
    if (parsed === undefined || parsed === TRANSPARENT_PAINT) return history.slice(0, limit);
    const key = paintKey(parsed);
    return [parsed, ...history.filter(entry => paintKey(entry) !== key)].slice(0, limit);
}

/** 読めない値を捨てる（localStorage など外から来た履歴）。 */
export function parseColorHistory(raw: unknown, limit = COLOR_HISTORY_LIMIT): Paint[] {
    if (!Array.isArray(raw)) return [];
    let result: Paint[] = [];
    for (const entry of [...raw].reverse()) {
        const parsed = parsePaint(entry);
        if (parsed !== undefined) result = pushColorHistory(result, parsed, limit);
    }
    return result;
}

/** パネルに出す履歴の並び: 今の色が履歴に無ければ先頭に足す（いまの色に印を付けるため）。 */
export function historyRow(history: readonly Paint[], current: Paint | undefined, allowGradient: boolean): Paint[] {
    const usable = history.filter(entry => allowGradient || !isGradientPaint(entry));
    const parsed = parsePaint(current);
    if (parsed === undefined || parsed === TRANSPARENT_PAINT || (!allowGradient && isGradientPaint(parsed))) {
        return usable.slice(0, COLOR_HISTORY_LIMIT);
    }
    if (usable.some(entry => samePaint(entry, parsed))) return usable.slice(0, COLOR_HISTORY_LIMIT);
    return [parsed, ...usable].slice(0, COLOR_HISTORY_LIMIT);
}

// ---- このデザインの色 ----

const COLOR_KEY = /(color|colour|fill|stroke|background)/iu;

/**
 * edit.json・captions.json から、この動画で使っている色を集める。
 * 色らしい鍵（color / fill / stroke / background を含む）の `#RRGGBB(AA)` とグラデーションを、
 * 使われている回数の多い順（同数は先に出た順）に返す。
 */
export function collectDesignColors(documents: readonly unknown[], limit = 14): Paint[] {
    const counts = new Map<string, { paint: Paint; count: number; order: number }>();
    let order = 0;
    const add = (value: unknown): void => {
        const parsed = parsePaint(value);
        if (parsed === undefined || parsed === TRANSPARENT_PAINT) return;
        const key = paintKey(parsed);
        const entry = counts.get(key);
        if (entry) entry.count += 1;
        else counts.set(key, { paint: parsed, count: 1, order: order++ });
    };
    const walk = (node: unknown, colorish: boolean, depth: number): void => {
        if (depth > 40 || node === null || node === undefined) return;
        if (typeof node === 'string') {
            if (colorish) add(node);
            return;
        }
        if (Array.isArray(node)) {
            for (const child of node) walk(child, colorish, depth + 1);
            return;
        }
        if (typeof node !== 'object') return;
        if (colorish && isGradientPaint(node)) {
            add(node);
            return;
        }
        for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
            walk(child, COLOR_KEY.test(key), depth + 1);
        }
    };
    for (const document of documents) walk(document, false, 0);
    return [...counts.values()]
        .sort((a, b) => b.count - a.count || a.order - b.order)
        .slice(0, limit)
        .map(entry => entry.paint);
}

// ---- 写真の色 ----

export interface PhotoSource {
    path: string;
    kind: 'image' | 'video';
}

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif)$/iu;
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv)$/iu;

/**
 * 置いた画像・B-roll（edit.json の visual レーンにある media の item）を集める。
 * 画像はどこに置いたものでも、動画は一番上の visual トラック（本編のカット）以外にあるものだけ。
 */
export function photoSourcesFromEdit(edit: unknown, limit = 4): PhotoSource[] {
    if (!edit || typeof edit !== 'object') return [];
    const doc = edit as { sources?: unknown; tracks?: unknown };
    const sourcePaths = new Map<string, string>();
    if (Array.isArray(doc.sources)) {
        for (const row of doc.sources) {
            const { id, path } = (row ?? {}) as { id?: unknown; path?: unknown };
            if (typeof id === 'string' && typeof path === 'string') sourcePaths.set(id, path);
        }
    }
    const result: PhotoSource[] = [];
    const seen = new Set<string>();
    const visit = (items: unknown, mainTrack: boolean, depth: number): void => {
        if (!Array.isArray(items) || depth > 8) return;
        for (const item of items) {
            if (!item || typeof item !== 'object') continue;
            const source = (item as { source?: { kind?: unknown; src?: unknown; path?: unknown } }).source;
            if (source?.kind === 'media') {
                const path = typeof source.src === 'string' ? sourcePaths.get(source.src)
                    : typeof source.path === 'string' ? source.path : undefined;
                const kind = path && IMAGE_EXT.test(path) ? 'image' : path && VIDEO_EXT.test(path) ? 'video' : undefined;
                if (path && kind && !seen.has(path) && (kind === 'image' || !mainTrack)) {
                    seen.add(path);
                    result.push({ path, kind });
                }
            }
            visit((item as { items?: unknown }).items, mainTrack, depth + 1);
        }
    };
    if (Array.isArray(doc.tracks)) {
        let firstVisual = true;
        for (const track of doc.tracks) {
            const { lane, items } = (track ?? {}) as { lane?: unknown; items?: unknown };
            if (lane !== 'visual') continue;
            visit(items, firstVisual, 0);
            firstVisual = false;
        }
    }
    // 画像を先に（写真の色は画像がいちばん分かりやすい）。
    return [...result.filter(entry => entry.kind === 'image'), ...result.filter(entry => entry.kind === 'video')].slice(0, limit);
}

/**
 * 画素（RGBA の並び）から代表色を count 個取る。
 * 各チャンネル 4bit の箱で数え、多い箱から「既に選んだ色と十分に離れている」ものを拾う。
 * 決定論（同じ画素なら同じ結果）。
 */
export function extractPalette(pixels: ArrayLike<number>, count = 5): string[] {
    const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
    for (let i = 0; i + 3 < pixels.length; i += 4) {
        if (pixels[i + 3] < 128) continue;
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
        const bin = bins.get(key);
        if (bin) {
            bin.n += 1; bin.r += r; bin.g += g; bin.b += b;
        } else {
            bins.set(key, { n: 1, r, g, b });
        }
    }
    const ranked = [...bins.entries()]
        .map(([key, bin]) => ({ key, n: bin.n, rgb: [bin.r / bin.n, bin.g / bin.n, bin.b / bin.n] as const }))
        .sort((a, b) => b.n - a.n || a.key - b.key);
    const picked: (readonly [number, number, number])[] = [];
    for (const threshold of [72, 48, 28, 12, 0]) {
        for (const entry of ranked) {
            if (picked.length >= count) break;
            if (picked.includes(entry.rgb)) continue;
            const far = picked.every(color => Math.hypot(color[0] - entry.rgb[0], color[1] - entry.rgb[1], color[2] - entry.rgb[2]) > threshold);
            if (far) picked.push(entry.rgb);
        }
        if (picked.length >= count) break;
    }
    return picked.map(([r, g, b]) => rgbToHex(r, g, b));
}

// ---- 対象 ----

/**
 * `akari.inspector.openColorPanel` の対象。
 * - field: 今選んでいるものの、インスペクターの色の行（行の名前 = `data-akari-field` の値）
 * - item: edit.json の item の中の値（`path` は item からのドット区切り。例 `source.params.fill`）
 */
export type ColorPanelTarget =
    | { kind: 'field'; field: string }
    | { kind: 'item'; itemId: string; path: string };

export interface ColorPanelOpenRequest {
    target: ColorPanelTarget;
    /** グラデーションを出す（図形・ラインだけ）。既定 false。 */
    allowGradient?: boolean;
    /** 透明を出す（塗りだけ）。既定 false。 */
    allowTransparent?: boolean;
    /** パネルの見出し（省略時は行の名前）。 */
    title?: string;
    /** 同じ対象で開いていたら閉じる（バーの色の丸をもう一度押したとき）。 */
    toggle?: boolean;
}

export function parseColorPanelOpenRequest(raw: unknown): ColorPanelOpenRequest | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const value = raw as Record<string, unknown>;
    const target = value.target as Record<string, unknown> | undefined;
    let parsedTarget: ColorPanelTarget | undefined;
    if (target?.kind === 'field' && typeof target.field === 'string' && target.field) {
        parsedTarget = { kind: 'field', field: target.field };
    } else if (target?.kind === 'item' && typeof target.itemId === 'string' && target.itemId
        && typeof target.path === 'string' && /^[A-Za-z_][\w-]*(\.[A-Za-z_][\w-]*)*$/u.test(target.path)) {
        parsedTarget = { kind: 'item', itemId: target.itemId, path: target.path };
    }
    if (!parsedTarget) return undefined;
    return {
        target: parsedTarget,
        allowGradient: value.allowGradient === true,
        allowTransparent: value.allowTransparent === true,
        title: typeof value.title === 'string' && value.title.trim() ? value.title.trim() : undefined,
        toggle: value.toggle === true
    };
}

export function sameColorPanelTarget(a: ColorPanelTarget, b: ColorPanelTarget): boolean {
    return a.kind === 'field' && b.kind === 'field' ? a.field === b.field
        : a.kind === 'item' && b.kind === 'item' ? a.itemId === b.itemId && a.path === b.path : false;
}

/** item の中の値をドット区切りで読む。 */
export function readItemPath(item: unknown, path: string): unknown {
    let node = item;
    for (const key of path.split('.')) {
        if (!node || typeof node !== 'object') return undefined;
        node = (node as Record<string, unknown>)[key];
    }
    return node;
}

/**
 * item の中のドット区切りの path へ値を置いた「一番上の鍵ごと差し替える」patch を作る
 * （edit-store の updateItem は source の中を浅くしか混ぜないため、入れ子は丸ごと作り直して渡す）。
 * `source.params.fill` → `{ source: { ...item.source, params: { ...item.source.params, fill: value } } }`。
 * value が undefined なら、その鍵を消す。
 */
export function itemPathPatch(item: unknown, path: string, value: unknown): Record<string, unknown> {
    const keys = path.split('.');
    const set = (node: unknown, index: number): unknown => {
        const base = node && typeof node === 'object' && !Array.isArray(node) ? { ...(node as Record<string, unknown>) } : {};
        const key = keys[index];
        if (index === keys.length - 1) {
            if (value === undefined) delete base[key];
            else base[key] = JSON.parse(JSON.stringify(value));
        } else {
            base[key] = set(base[key], index + 1);
        }
        return base;
    };
    const top = keys[0];
    const current = item && typeof item === 'object' ? (item as Record<string, unknown>)[top] : undefined;
    if (keys.length === 1) return { [top]: value === undefined ? null : JSON.parse(JSON.stringify(value)) };
    return { [top]: set(current, 1) };
}

/** edit.json の中から id の item を探す（入れ子の items も見る）。 */
export function findEditItem(edit: unknown, id: string): Record<string, unknown> | undefined {
    const visit = (items: unknown, depth: number): Record<string, unknown> | undefined => {
        if (!Array.isArray(items) || depth > 8) return undefined;
        for (const item of items) {
            if (!item || typeof item !== 'object') continue;
            if ((item as { id?: unknown }).id === id) return item as Record<string, unknown>;
            const found = visit((item as { items?: unknown }).items, depth + 1);
            if (found) return found;
        }
        return undefined;
    };
    const tracks = edit && typeof edit === 'object' ? (edit as { tracks?: unknown }).tracks : undefined;
    if (!Array.isArray(tracks)) return undefined;
    for (const track of tracks) {
        const found = visit((track as { items?: unknown } | null)?.items, 0);
        if (found) return found;
    }
    return undefined;
}

/** edit.json から captions の器のファイル（captions.json など）を集める。 */
export function captionPathsFromEdit(edit: unknown): string[] {
    const result: string[] = [];
    const visit = (items: unknown, depth: number): void => {
        if (!Array.isArray(items) || depth > 8) return;
        for (const item of items) {
            const source = (item as { source?: { kind?: unknown; path?: unknown } } | null)?.source;
            if (source?.kind === 'captions' && typeof source.path === 'string' && !result.includes(source.path)) result.push(source.path);
            visit((item as { items?: unknown } | null)?.items, depth + 1);
        }
    };
    const tracks = edit && typeof edit === 'object' ? (edit as { tracks?: unknown }).tracks : undefined;
    if (Array.isArray(tracks)) for (const track of tracks) visit((track as { items?: unknown } | null)?.items, 0);
    return result;
}
