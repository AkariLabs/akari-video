import { captionTextStyleVars } from 'akari-preview/lib/browser/akari-preview-captions';
import type { CaptionTextStyle } from './caption-store';
import { CAPTION_HOVER_PREVIEW_CSS } from '../browser/style/caption-hover-preview-style';
import { hoverPopupGeometry, HoverPopupGeometryInput } from './hover-popup-geometry';

export interface CaptionHoverPreviewInput extends HoverPopupGeometryInput {
    text: string;
    textStyle?: CaptionTextStyle;
}

/** 渡された値だけから未接続の DOM を作る。出力座標で組み、文字・縁取りごと縮小する。 */
export function createCaptionHoverPreview(document: Pick<Document, 'createElement'>,
    input: CaptionHoverPreviewInput): HTMLDivElement {
    const hasOutput = Number.isFinite(input.width) && input.width > 0
        && Number.isFinite(input.height) && input.height > 0;
    const width = hasOutput ? input.width : 1920;
    const height = hasOutput ? input.height : 1080;
    const geometry = hoverPopupGeometry({ ...input, naturalWidth: undefined, naturalHeight: undefined });
    const frame = document.createElement('div');
    frame.className = 'akari-caption-hover-preview';
    Object.assign(frame.style, { position: 'relative', overflow: 'hidden', pointerEvents: 'none',
        background: '#000', width: `${geometry.imageWidth}px`, height: `${geometry.imageHeight}px` });
    const css = document.createElement('style');
    css.textContent = CAPTION_HOVER_PREVIEW_CSS;
    const stage = document.createElement('div');
    Object.assign(stage.style, { position: 'absolute', width: `${width}px`, height: `${height}px`,
        transformOrigin: 'top left', transform: `scale(${geometry.imageWidth / width})` });
    const caption = document.createElement('div');
    caption.className = 'akari-caption';
    const style = input.textStyle;
    caption.style.setProperty('--caption-font-size', `${height > width ? Math.round(width * 0.06) : 38}px`);
    for (const [name, value] of Object.entries(captionTextStyleVars(style))) {
        caption.style.setProperty(name, value);
    }
    if (style?.fontFamily !== undefined) caption.style.fontFamily = style.fontFamily;
    if (style?.fontWeight !== undefined || style?.weight !== undefined) {
        caption.style.fontWeight = String(style.fontWeight ?? style.weight);
    }
    if (style?.italic !== undefined) caption.style.fontStyle = style.italic ? 'italic' : 'normal';
    if (style?.underline !== undefined) caption.style.textDecoration = style.underline ? 'underline' : 'none';
    if (style?.letterSpacingEm !== undefined) caption.style.letterSpacing = `${style.letterSpacingEm}em`;
    if (style?.lineHeight !== undefined) caption.style.lineHeight = String(style.lineHeight);
    const plate = document.createElement('div');
    plate.className = 'akari-caption__plate';
    let container = plate;
    if (style?.background?.mode === 'block') {
        container = document.createElement('div');
        container.className = 'akari-caption__block';
        plate.append(container);
    }
    for (const text of splitCaptionLines(input.text, height > width ? 10 : 20)) {
        const line = document.createElement('p');
        line.className = 'akari-caption__line';
        line.textContent = text;
        container.append(line);
    }
    caption.append(plate);
    stage.append(caption);
    frame.append(css, stage);
    return frame;
}

// 出所: akari-preview の src/browser/akari-preview-open-handler.ts の splitCaptionLines。
// 埋め込み関数のため、静的本文用の分割規則を二重管理する（句読点 → 空白 → 文節 → 上限）。
function splitCaptionLines(text: string, maximum: number): string[] {
    const boundaries = ['から', 'まで', 'ので', 'のに', 'けど', 'て', 'で', 'は', 'が', 'を', 'に', 'へ', 'と', 'も', 'の'];
    return text.split(/\r?\n/u).flatMap(line => {
        if (!line) return [''];
        return line.split(/(?<=[、。])/u).flatMap(segment => {
            const lines: string[] = [];
            let remaining = Array.from(segment);
            while (remaining.length > maximum) {
                let boundary = 0;
                for (let index = maximum - 1; index > 0; index--) {
                    if (remaining[index] === ' ' || remaining[index] === '　') {
                        boundary = index + 1;
                        break;
                    }
                }
                if (!boundary) {
                    const prefix = remaining.slice(0, maximum).join('');
                    for (const phrase of boundaries) {
                        const index = prefix.lastIndexOf(phrase);
                        if (index >= 0) boundary = Math.max(boundary, Array.from(prefix.slice(0, index + phrase.length)).length);
                    }
                }
                boundary ||= maximum;
                lines.push(remaining.slice(0, boundary).join(''));
                remaining = remaining.slice(boundary);
            }
            if (remaining.length) lines.push(remaining.join(''));
            return lines;
        });
    });
}
