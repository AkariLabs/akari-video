import { arrowHead, boundingBox, InkDocument, InkPoint } from '../common/ink-model';

export interface InkRenderOptions { width: number; height: number; background?: string; selectedIds?: Iterable<string> }
const escapeXml = (value: unknown): string => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const number = (value: number): string => String(Number(value.toFixed(6)));

/** The SVG viewBox uses paper height as one unit; normalized x is scaled by aspect. */
export function inkToSvg(doc: InkDocument, opts: InkRenderOptions): string {
    const ratio = opts.width / opts.height;
    const px = (p: InkPoint): string => `${number(p[0] * ratio)} ${number(p[1])}`;
    const selected = new Set(opts.selectedIds ?? []);
    const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${number(opts.width)}" height="${number(opts.height)}" viewBox="0 0 ${number(ratio)} 1">`];
    if (opts.background) {
        if (/^data:image\//.test(opts.background)) parts.push(`<image href="${escapeXml(opts.background)}" x="0" y="0" width="${number(ratio)}" height="1" preserveAspectRatio="none"/>`);
        else parts.push(`<rect x="0" y="0" width="${number(ratio)}" height="1" fill="${escapeXml(opts.background)}"/>`);
    }
    for (const obj of doc.objects) {
        const color = escapeXml(obj.color);
        if (obj.type === 'pen' && obj.points.length) {
            const [first, ...rest] = obj.points;
            let path = `M ${px(first)}`;
            if (rest.length === 1) path += ` L ${px(rest[0])}`;
            else for (let i = 0; i < rest.length; i += 1) {
                const current = rest[i];
                const next = rest[i + 1];
                path += next ? ` Q ${px(current)} ${px([(current[0] + next[0]) / 2, (current[1] + next[1]) / 2])}` : ` L ${px(current)}`;
            }
            parts.push(`<path data-ink-id="${escapeXml(obj.id)}" d="${path}" fill="none" stroke="${color}" stroke-width="${number(obj.strokeWidth)}" stroke-linecap="round" stroke-linejoin="round"/>`);
        } else if (obj.type === 'arrow') {
            const [left, right] = arrowHead(obj, { w: opts.width, h: opts.height });
            parts.push(`<path data-ink-id="${escapeXml(obj.id)}" d="M ${px(obj.from)} L ${px(obj.to)} M ${px(left)} L ${px(obj.to)} L ${px(right)}" fill="none" stroke="${color}" stroke-width="${number(obj.strokeWidth)}" stroke-linecap="round" stroke-linejoin="round"/>`);
        } else if (obj.type === 'text') {
            const lines = obj.text.split('\n');
            parts.push(`<text data-ink-id="${escapeXml(obj.id)}" x="${number(obj.at[0] * ratio)}" y="${number(obj.at[1])}" fill="${color}" font-size="${number(obj.textHeight)}" xml:space="preserve">`);
            for (let i = 0; i < lines.length; i += 1) parts.push(`<tspan x="${number(obj.at[0] * ratio)}" dy="${i ? number(obj.textHeight) : '0'}">${escapeXml(lines[i])}</tspan>`);
            parts.push('</text>');
        }
        if (selected.has(obj.id)) {
            const box = boundingBox(obj);
            const pad = 0.008;
            const x = Math.max(0, box.x * ratio - pad); const y = Math.max(0, box.y - pad);
            const w = Math.min(ratio - x, box.w * ratio + pad * 2);
            const h = Math.min(1 - y, box.h + pad * 2);
            parts.push(`<rect data-ink-selection="${escapeXml(obj.id)}" x="${number(x)}" y="${number(y)}" width="${number(w)}" height="${number(h)}" rx="0.004" fill="none" stroke="var(--akari-accent)" stroke-opacity="0.55" stroke-width="0.002" pointer-events="none"/>`);
            for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
                parts.push(`<circle cx="${number(cx)}" cy="${number(cy)}" r="0.004" fill="var(--akari-accent)" pointer-events="none"/>`);
            }
        }
    }
    parts.push('</svg>');
    return parts.join('');
}

/** Browser-only rasterization, kept out of the pure SVG path. */
export async function inkToPngDataUrl(doc: InkDocument, opts: InkRenderOptions): Promise<string> {
    const svg = inkToSvg(doc, opts);
    const svgImage = new Image();
    await new Promise<void>((resolve, reject) => {
        svgImage.onload = () => resolve();
        svgImage.onerror = () => reject(new Error('SVG image could not be decoded'));
        svgImage.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    });
    const canvas = document.createElement('canvas');
    canvas.width = opts.width; canvas.height = opts.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context is unavailable');
    context.drawImage(svgImage, 0, 0, opts.width, opts.height);
    return canvas.toDataURL('image/png');
}
