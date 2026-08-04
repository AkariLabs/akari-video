import URI from '@theia/core/lib/common/uri';

export const PREVIEW_CAPTION_ZONES = [
    'top-left', 'top', 'top-right',
    'left', 'center', 'right',
    'bottom-left', 'bottom', 'bottom-right'
] as const;

export type PreviewCaptionZone = typeof PREVIEW_CAPTION_ZONES[number];

export interface PreviewCaptionTextStyle {
    color?: string;
    sizePx?: number;
    stroke?: { color?: string; widthPx?: number };
    background?: {
        color?: string;
        opacity?: number;
        radiusPx?: number;
        mode?: 'per-line' | 'block';
    };
    zone?: PreviewCaptionZone;
}

// akari-transcript の Caption から、プレビュー表示に必要なフィールドだけを複製する。
// ㉓ 字幕クリック選択+移動の書き戻し（captions.json text_style.zone）に caption を
// 一意に特定する id が必要になったため追加（他フィールドは既存どおり最小限のまま）。
export interface PreviewCaption {
    id?: string;
    start: number;
    end: number;
    text: string;
    style?: 'karaoke' | 'pop';
    words?: { start: number; end: number; text: string }[];
    textStyle?: PreviewCaptionTextStyle;
    textStyleVars?: Record<string, string>;
}

export function locatePreviewCaptions(editUri: URI | undefined, workspaceRoot: URI | undefined): URI | undefined {
    const base = editUri ? editUri.parent : workspaceRoot?.resolve('project');
    return base?.resolve('captions.json');
}

export function parsePreviewCaptions(source: string): PreviewCaption[] {
    const root: unknown = JSON.parse(source);
    const values = Array.isArray(root)
        ? root
        : isRecord(root) && Array.isArray(root.captions)
            ? root.captions
            : undefined;
    if (!values) {
        throw new Error('captions.json must be an array or an object with captions[]');
    }
    const defaultTextStyle = !Array.isArray(root) && isRecord(root)
        ? normalizeTextStyle(root.default_text_style)
        : undefined;
    if (!Array.isArray(root) && isRecord(root)
        && root.default_text_style !== undefined && defaultTextStyle === undefined) {
        throw new Error('captions.json default_text_style is invalid');
    }
    const captions: PreviewCaption[] = [];
    for (const value of values) {
        if (!value || typeof value !== 'object') {
            continue;
        }
        const candidate = value as Record<string, unknown>;
        const { start, end, text, id } = candidate;
        if (typeof start !== 'number' || typeof end !== 'number'
            || !Number.isFinite(start) || !Number.isFinite(end) || start >= end
            || typeof text !== 'string') {
            continue;
        }
        const style = candidate.style === 'karaoke' || candidate.style === 'pop'
            ? candidate.style
            : undefined;
        const words = Array.isArray(candidate.words)
            ? candidate.words.flatMap(word => {
                if (!word || typeof word !== 'object') {
                    return [];
                }
                const item = word as Record<string, unknown>;
                return typeof item.start === 'number' && Number.isFinite(item.start)
                    && typeof item.end === 'number' && Number.isFinite(item.end) && item.end > item.start
                    && typeof item.text === 'string' && item.text.length > 0
                    ? [{ start: item.start, end: item.end, text: item.text }]
                    : [];
            })
            : [];
        // text_style は「見た目の上書き」であって字幕の本体ではない。読めない値でも
        // 字幕そのものは既定スタイルで出す（消さない）。null は「指定なし」— スキーマ検証も
        // 共有カーネル mergeCaptionTextStyles も render-cut も Web UI も null を既定扱いする。
        // 旧実装は null / 不正値のとき caption ごと捨てており、カラオケ字幕が無言で消えていた。
        const captionTextStyle = candidate.text_style === undefined || candidate.text_style === null
            ? undefined
            : normalizeTextStyle(candidate.text_style);
        if (candidate.text_style !== undefined && candidate.text_style !== null
            && captionTextStyle === undefined) {
            console.warn(
                '[akari-preview] text_style を読み取れないため既定スタイルで表示します',
                typeof id === 'string' ? id : '(id なし)'
            );
        }
        const textStyle = mergeTextStyles(defaultTextStyle, captionTextStyle);
        captions.push({
            ...(typeof id === 'string' && id ? { id } : {}),
            start,
            end,
            text,
            ...(style ? { style } : {}),
            ...(words.length > 0 ? { words } : {}),
            ...(textStyle ? {
                textStyle,
                textStyleVars: captionTextStyleVars(textStyle)
            } : {})
        });
    }
    return captions;
}

export function captionTextStyleVars(style: PreviewCaptionTextStyle | undefined): Record<string, string> {
    if (!style) {
        return {};
    }
    const vars: Record<string, string> = {};
    if (style.color !== undefined) {
        vars['--caption-color'] = style.color;
    }
    if (style.sizePx !== undefined) {
        vars['--caption-font-size'] = `${style.sizePx}px`;
    }
    if (style.stroke && (style.stroke.color !== undefined || style.stroke.widthPx !== undefined)) {
        vars['--caption-text-shadow'] = strokeShadow(
            style.stroke.color ?? 'rgba(0,0,0,.85)',
            style.stroke.widthPx ?? 1.5
        );
    }
    if (style.background
        && (style.background.color !== undefined || style.background.opacity !== undefined)) {
        const backgroundVariable = style.background.mode === 'block' ? '--plate-block-bg' : '--plate-bg';
        vars[backgroundVariable] = colorWithOpacity(
            style.background.color ?? '#000000',
            style.background.opacity
        );
    }
    if (style.background?.radiusPx !== undefined) {
        const radiusVariable = style.background.mode === 'block' ? '--plate-block-radius' : '--plate-radius';
        vars[radiusVariable] = `${style.background.radiusPx}px`;
    }
    Object.assign(vars, zoneVars(style.zone));
    return vars;
}

function isRecord(value: unknown): value is Record<string, any> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeTextStyle(value: unknown): PreviewCaptionTextStyle | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    const style: PreviewCaptionTextStyle = {};
    if (typeof value.color === 'string') style.color = value.color;
    if (typeof value.size_px === 'number' && Number.isFinite(value.size_px)) style.sizePx = value.size_px;
    if (PREVIEW_CAPTION_ZONES.includes(value.zone as PreviewCaptionZone)) {
        style.zone = value.zone as PreviewCaptionZone;
    }
    if (isRecord(value.stroke)) {
        style.stroke = {
            ...(typeof value.stroke.color === 'string' ? { color: value.stroke.color } : {}),
            ...(typeof value.stroke.width_px === 'number' && Number.isFinite(value.stroke.width_px)
                ? { widthPx: value.stroke.width_px } : {})
        };
    }
    if (isRecord(value.background)) {
        style.background = {
            ...(typeof value.background.color === 'string' ? { color: value.background.color } : {}),
            ...(typeof value.background.opacity === 'number' && Number.isFinite(value.background.opacity)
                ? { opacity: value.background.opacity } : {}),
            ...(typeof value.background.radius_px === 'number' && Number.isFinite(value.background.radius_px)
                ? { radiusPx: value.background.radius_px } : {}),
            ...(value.background.mode === 'per-line' || value.background.mode === 'block'
                ? { mode: value.background.mode } : {})
        };
    }
    return style;
}

function mergeTextStyles(
    base: PreviewCaptionTextStyle | undefined,
    override: PreviewCaptionTextStyle | undefined
): PreviewCaptionTextStyle | undefined {
    const merged: PreviewCaptionTextStyle = {
        ...base,
        ...override,
        ...(base?.stroke || override?.stroke ? { stroke: { ...base?.stroke, ...override?.stroke } } : {}),
        ...(base?.background || override?.background
            ? { background: { ...base?.background, ...override?.background } } : {})
    };
    if (merged.stroke && Object.keys(merged.stroke).length === 0) delete merged.stroke;
    if (merged.background && Object.keys(merged.background).length === 0) delete merged.background;
    return Object.keys(merged).length > 0 ? merged : undefined;
}

function strokeShadow(color: string, width: number): string {
    const negative = width === 0 ? '0' : `-${width}px`;
    const positive = width === 0 ? '0' : `${width}px`;
    return `${negative} ${negative} 0 ${color}, ${positive} ${negative} 0 ${color}, `
        + `${negative} ${positive} 0 ${color}, ${positive} ${positive} 0 ${color}, `
        + '0 0 8px rgba(0,0,0,.6)';
}

function colorWithOpacity(color: string, explicitOpacity: number | undefined): string {
    const expanded = color.slice(1).length === 3
        ? color.slice(1).split('').map(character => character + character).join('')
        : color.slice(1);
    const rgb = expanded.slice(0, 6).padEnd(6, '0');
    const alphaFromColor = expanded.length === 8 ? parseInt(expanded.slice(6, 8), 16) / 255 : 1;
    const alpha = explicitOpacity ?? alphaFromColor;
    return `rgba(${parseInt(rgb.slice(0, 2), 16)},${parseInt(rgb.slice(2, 4), 16)},`
        + `${parseInt(rgb.slice(4, 6), 16)},${Number(alpha.toFixed(4))})`;
}

function zoneVars(zone: PreviewCaptionZone | undefined): Record<string, string> {
    if (!zone || zone === 'bottom') {
        return {};
    }
    const [vertical, horizontal] = zone.includes('-')
        ? zone.split('-') as ['top' | 'bottom', 'left' | 'right']
        : zone === 'top' || zone === 'center'
            ? [zone, 'center'] as const
            : ['center', zone] as const;
    return {
        '--caption-top': vertical === 'top' ? '7%' : vertical === 'center' ? '0' : 'auto',
        '--caption-bottom': vertical === 'bottom' ? '7%' : vertical === 'center' ? '0' : 'auto',
        '--caption-left': '4%',
        '--caption-right': '4%',
        '--caption-justify-content': vertical === 'center' ? 'center' : 'flex-start',
        '--caption-align-items': horizontal === 'left'
            ? 'flex-start' : horizontal === 'right' ? 'flex-end' : 'center',
        '--caption-line-margin': '0',
        '--caption-line-max-width': '100%',
        '--caption-text-align': horizontal
    };
}
