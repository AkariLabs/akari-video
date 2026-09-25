import URI from '@theia/core/lib/common/uri';
import {
    applyCaptionStylePresets,
    captionAnchorPositionVars,
    expandCaptionDisplayFragments,
    mergeCaptionLineTextStyles,
    resolveCaptionLineStyleVars,
    sliceCaptionRuns,
    TEXTSTYLE_CATALOG
} from '@akari-video/edit-store';
import type { CaptionRun } from '@akari-video/edit-store';
import { ResolvedCaptionDisplayPayload } from '../common/akari-preview-protocol';

export const PREVIEW_CAPTION_ZONES = [
    'top-left', 'top', 'top-right',
    'left', 'center', 'right',
    'bottom-left', 'bottom', 'bottom-right'
] as const;

export type PreviewCaptionZone = typeof PREVIEW_CAPTION_ZONES[number];

export type PreviewCaptionTextStyle = Record<string, any>;

export interface LegacyPreviewCaptionTextStyle {
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
    textAnchor?: string;
    position?: { x?: number; y?: number };
    verticalAlign?: 'top' | 'middle' | 'bottom';
    scale?: number;
    rotate?: number;
}

// akari-transcript の Caption から、プレビュー表示に必要なフィールドだけを複製する。
// ㉓ 字幕クリック選択+移動の書き戻し（captions.json text_style.zone）に caption を
// 一意に特定する id が必要になったため追加（他フィールドは既存どおり最小限のまま）。
export interface PreviewCaption {
    id?: string;
    start: number;
    end: number;
    text: string;
    style?: 'karaoke' | 'pop' | 'reveal' | 'reveal-word';
    words?: { start: number; end: number; text: string }[];
    textStyle?: PreviewCaptionTextStyle;
    textStyleVars?: Record<string, string>;
    displayLines?: string[];
    resolvedWords?: { start: number; end: number; text: string; line: number }[];
    wordStyles?: { from: number; to: number; preset_id: string; style_vars: Record<string, string> }[];
    runs?: CaptionRun[];
    sourceCueId?: string;
    /** 明示的なキャンバス内字幕の表示段。元の字幕行には付かない。 */
    canvasTrackId?: string;
    resolvedTimeline?: boolean;
    fragmentKey?: string;
    fragmentIndex?: number;
    fragmentCount?: number;
}

export interface CaptionDisplayFallbackState {
    lastCode?: string;
}

export function captionDisplayErrorCode(error: unknown): string {
    if (isRecord(error) && typeof error.code === 'string' && error.code.trim()) return error.code.trim();
    const message = error instanceof Error ? error.message : String(error);
    return message.match(/\b([A-Z][A-Z0-9_]{2,})\b/u)?.[1] ?? 'CAPTION_DISPLAY_RESOLUTION_FAILED';
}

export async function loadCaptionDisplayFailOpen<TResolved, TLoaded>(options: {
    resolve: () => Promise<TResolved | null>;
    resolved: (value: TResolved) => TLoaded;
    legacy: () => Promise<TLoaded>;
    warn: (code: string) => void;
    state: CaptionDisplayFallbackState;
}): Promise<TLoaded> {
    try {
        const value = await options.resolve();
        if (value !== null) {
            const loaded = options.resolved(value);
            options.state.lastCode = undefined;
            return loaded;
        }
    } catch (error) {
        const loaded = await options.legacy();
        const code = captionDisplayErrorCode(error);
        if (options.state.lastCode !== code) options.warn(code);
        options.state.lastCode = code;
        return loaded;
    }
    const loaded = await options.legacy();
    options.state.lastCode = undefined;
    return loaded;
}

export function locatePreviewCaptions(editUri: URI | undefined, workspaceRoot: URI | undefined): URI | undefined {
    const base = editUri ? editUri.parent : workspaceRoot?.resolve('project');
    return base?.resolve('captions.json');
}

export function parsePreviewCaptions(
    source: string,
    output?: { width: number; height: number }
): PreviewCaption[] {
    let root: unknown = JSON.parse(source);
    root = applyCaptionStylePresets(root, TEXTSTYLE_CATALOG).root;
    const values = Array.isArray(root)
        ? root
        : isRecord(root) && Array.isArray(root.captions)
            ? root.captions
            : undefined;
    if (!values) {
        throw new Error('captions.json must be an array or an object with captions[]');
    }
    const defaultTextStyle = !Array.isArray(root) && isRecord(root)
        ? (isRecord(root.default_text_style) ? root.default_text_style : undefined)
        : undefined;
    if (!Array.isArray(root) && isRecord(root)
        && root.default_text_style !== undefined && defaultTextStyle === undefined) {
        throw new Error('captions.json default_text_style is invalid');
    }
    const captions: PreviewCaption[] = [];
    for (const value of expandCaptionDisplayFragments(values as Record<string, unknown>[])) {
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
            || candidate.style === 'reveal' || candidate.style === 'reveal-word'
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
            : (isRecord(candidate.text_style) ? candidate.text_style : undefined);
        if (candidate.text_style !== undefined && candidate.text_style !== null
            && captionTextStyle === undefined) {
            console.warn(
                '[akari-preview] text_style を読み取れないため既定スタイルで表示します',
                typeof id === 'string' ? id : '(id なし)'
            );
        }
        const textStyle = mergeCaptionLineTextStyles(defaultTextStyle, captionTextStyle) ?? undefined;
        captions.push({
            ...(typeof id === 'string' && id ? { id } : {}),
            start,
            end,
            text: Array.isArray(candidate.runs) && typeof candidate.display_text === 'string'
                ? candidate.display_text : text,
            ...(typeof candidate.fragmentKey === 'string' ? { fragmentKey: candidate.fragmentKey } : {}),
            ...(typeof candidate.fragmentIndex === 'number' ? { fragmentIndex: candidate.fragmentIndex } : {}),
            ...(typeof candidate.fragmentCount === 'number' ? { fragmentCount: candidate.fragmentCount } : {}),
            ...(style ? { style } : {}),
            ...(words.length > 0 ? { words } : {}),
            ...(Array.isArray(candidate.runs) ? {
                runs: typeof candidate.runSourceText === 'string'
                    ? sliceCaptionRuns(candidate.runSourceText, candidate.runs as CaptionRun[],
                        Number(candidate.runTextStart), Number(candidate.runTextEnd))
                    : candidate.runs as CaptionRun[]
            } : {}),
            ...(textStyle ? {
                textStyle,
                textStyleVars: resolvePreviewCaptionStyleVars(textStyle, output)
            } : {})
        });
    }
    return captions;
}

export function parseResolvedPreviewCaptions(payload: ResolvedCaptionDisplayPayload): PreviewCaption[] {
    if (payload?.schema !== 'caption-layout/v1' || !Array.isArray(payload.captions)) {
        throw new Error('resolved caption payload is invalid');
    }
    return payload.captions.map(cue => {
        const textStyle = isRecord(cue.text_style) ? cue.text_style : undefined;
        const displayLines = (cue as unknown as { display_lines?: string[] }).display_lines;
        const wordDisplay = cue as unknown as {
            words?: { start: number; end: number; text: string; line: number }[];
            word_styles?: { from: number; to: number; preset_id: string; style_vars: Record<string, string> }[];
        };
        const hasWordDisplay = Array.isArray(wordDisplay.words) && Array.isArray(wordDisplay.word_styles);
        return {
            id: cue.id,
            sourceCueId: cue.source_cue_id,
            resolvedTimeline: true,
            start: cue.start,
            end: cue.end,
            text: cue.text,
            ...(Array.isArray((cue as { runs?: CaptionRun[] }).runs)
                ? { runs: (cue as { runs: CaptionRun[] }).runs.map(run => ({ ...run })) } : {}),
            ...(Array.isArray(displayLines) ? { displayLines: [...displayLines] } : {}),
            ...(hasWordDisplay ? {
                resolvedWords: wordDisplay.words!.map(word => ({ ...word })),
                wordStyles: wordDisplay.word_styles!.map(style => ({ ...style, style_vars: { ...style.style_vars } }))
            } : {}),
            ...(textStyle ? { textStyle } : {}),
            ...(cue.style_vars || textStyle ? {
                textStyleVars: {
                    ...(cue.style_vars ?? {}),
                    ...captionTransformStyleVars(textStyle)
                }
            } : {})
        };
    });
}

function resolvePreviewCaptionStyleVars(
    style: PreviewCaptionTextStyle | undefined,
    output?: { width: number; height: number }
): Record<string, string> {
    return { ...resolveCaptionLineStyleVars(style, output), ...captionTransformStyleVars(style) };
}

/**
 * akari-annotations の字幕ホバープレビュー専用の後方互換 shim。
 * 出力プレビュー経路（parsePreviewCaptions / parseResolvedPreviewCaptions）はカーネルの
 * resolveCaptionLineStyleVars を使う。別票で annotations 側もカーネルへ寄せる。
 */
export function captionTextStyleVars(style: LegacyPreviewCaptionTextStyle | undefined): Record<string, string> {
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
    if (typeof style.scale === 'number' && Number.isFinite(style.scale) && style.scale !== 1) {
        vars['--caption-scale'] = String(style.scale);
    }
    if (typeof style.rotate === 'number' && Number.isFinite(style.rotate) && style.rotate !== 0) {
        vars['--caption-rotate'] = `${style.rotate}deg`;
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
    Object.assign(vars, captionAnchorPositionVars(style.textAnchor, style.position, style.verticalAlign));
    return vars;
}

function captionTransformStyleVars(style: PreviewCaptionTextStyle | undefined): Record<string, string> {
    const vars: Record<string, string> = {};
    if (typeof style?.wrap_width_pct === 'number' && Number.isFinite(style.wrap_width_pct)
        && style.wrap_width_pct > 0 && style.wrap_width_pct <= 100) {
        vars['--caption-wrap-width'] = `${style.wrap_width_pct}%`;
    }
    if (typeof style?.scale === 'number' && Number.isFinite(style.scale) && style.scale !== 1) {
        vars['--caption-scale'] = String(style.scale);
    }
    if (typeof style?.rotate === 'number' && Number.isFinite(style.rotate) && style.rotate !== 0) {
        vars['--caption-rotate'] = `${style.rotate}deg`;
    }
    return vars;
}

function isRecord(value: unknown): value is Record<string, any> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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
