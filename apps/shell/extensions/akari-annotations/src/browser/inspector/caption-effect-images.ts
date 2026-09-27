import { CAPTION_EFFECT_SPECS, type CaptionEffectCardId } from './caption-style-effects';

/** The renderer is injectable so cache behavior is checked without a browser. */
export function createCaptionEffectImageCache(render: (id: CaptionEffectCardId) => string):
    (id: CaptionEffectCardId) => string {
    const cache = new Map<CaptionEffectCardId, string>();
    return id => {
        let image = cache.get(id);
        if (!image) {
            image = render(id);
            cache.set(id, image);
        }
        return image;
    };
}

/** Draw the first visible group immediately; paint each remaining group on a later frame. */
export function scheduleCaptionEffectImages<T>(groups: readonly (readonly T[])[],
    draw: (item: T) => void, nextFrame: (callback: () => void) => void): void {
    groups[0]?.forEach(draw);
    const later = (index: number): void => {
        if (index >= groups.length) return;
        nextFrame(() => { groups[index].forEach(draw); later(index + 1); });
    };
    later(1);
}

export const captionEffectImage = createCaptionEffectImageCache(id => {
    const canvas = document.createElement('canvas');
    canvas.width = 384;
    canvas.height = 144;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    const size = 16;
    for (let y = 0; y < canvas.height; y += size) for (let x = 0; x < canvas.width; x += size) {
        ctx.fillStyle = (x / size + y / size) % 2 ? '#b8b8b8' : '#d5d5d5';
        ctx.fillRect(x, y, size, size);
    }
    const spec = CAPTION_EFFECT_SPECS[id];
    const text = 'Abc あいう';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 43px sans-serif';
    const x = canvas.width / 2;
    const y = canvas.height / 2;
    if (spec.background) {
        ctx.fillStyle = spec.background.color!;
        ctx.globalAlpha = spec.background.opacity ?? 1;
        const radius = spec.background.radiusPx ?? 0;
        ctx.beginPath();
        ctx.roundRect(32, 37, 320, 70, radius);
        ctx.fill();
        ctx.globalAlpha = 1;
    }
    if (spec.shadow) {
        const angle = (spec.shadow.angleDeg ?? 90) * Math.PI / 180;
        ctx.shadowColor = spec.shadow.color!;
        ctx.shadowBlur = spec.shadow.blurPx ?? 0;
        ctx.shadowOffsetX = Math.cos(angle) * (spec.shadow.distancePx ?? 0);
        ctx.shadowOffsetY = Math.sin(angle) * (spec.shadow.distancePx ?? 0);
        ctx.globalAlpha = spec.shadow.opacity ?? 1;
        ctx.fillStyle = spec.color ?? '#ffffff';
        ctx.fillText(text, x, y);
        ctx.globalAlpha = 1;
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = ctx.shadowOffsetX = ctx.shadowOffsetY = 0;
    }
    if (spec.glow) {
        ctx.shadowColor = spec.glow.color!;
        ctx.shadowBlur = spec.glow.spread ?? 8;
        ctx.fillStyle = spec.glow.color!;
        ctx.fillText(text, x, y);
        ctx.shadowBlur = Math.max(2, (spec.glow.spread ?? 8) / 2);
        ctx.fillText(text, x, y);
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
    }
    ctx.strokeStyle = spec.stroke?.color ?? '#000000';
    ctx.lineWidth = (spec.stroke?.widthPx ?? 1.5) * 2;
    ctx.lineJoin = 'round';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = spec.color ?? '#ffffff';
    ctx.fillText(text, x, y);
    return canvas.toDataURL('image/png');
});
