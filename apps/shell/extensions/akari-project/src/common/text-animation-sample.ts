import { PREVIEW_CAPTION_ANIMATION_RECIPES } from 'akari-preview/lib/common/caption-text-animation-recipes';

export interface TextAnimationSample {
    keyframes: Keyframe[];
    durationMs: number;
}

/** 棚とマイスタイルで共用する、見本文字の 1 回分の動き。 */
export function textAnimationSampleKeyframes(id: string, slot: 'in' | 'loop' | 'out', amp?: number,
    durationSec?: number): TextAnimationSample {
    const recipe = PREVIEW_CAPTION_ANIMATION_RECIPES[id];
    // 既存の距離つまみ付き slide 見本はその距離を優先する。
    if (recipe && !(id === 'slide-left' && amp !== undefined) && !(id === 'zoom-pop' && slot === 'loop')) {
        const frames: Keyframe[] = [];
        for (const match of recipe.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
            const properties: Record<string, string | number> = {};
            for (const declaration of match[2].split(';')) {
                const colon = declaration.indexOf(':');
                if (colon < 0) continue;
                const key = declaration.slice(0, colon).trim().replace(/-([a-z])/gu, (_, letter: string) => letter.toUpperCase());
                const raw = declaration.slice(colon + 1).trim();
                properties[key] = key === 'opacity' ? Number(raw) : raw;
            }
            for (const selector of match[1].split(',')) {
                const marker = selector.trim();
                const offset = marker === 'from' ? 0 : marker === 'to' ? 1 : Number.parseFloat(marker) / 100;
                if (Number.isFinite(offset)) frames.push({ ...properties, offset });
            }
        }
        frames.sort((a, b) => (a.offset ?? 0) - (b.offset ?? 0));
        if (frames.length > 1) return {
            keyframes: slot === 'out' ? [...frames].reverse().map((frame, index) => ({
                ...frame, offset: frames[index].offset
            })) : frames,
            durationMs: typeof durationSec === 'number' ? Math.min(1800, Math.max(150, durationSec * 1000)) : 650
        };
    }
    const distance = typeof amp === 'number' ? Math.min(24, Math.max(3, amp)) : 12;
    const from: Keyframe = id.includes('slide-left') ? { opacity: 0, transform: `translateX(${distance}px)` }
        : id.includes('slide-right') ? { opacity: 0, transform: `translateX(-${distance}px)` }
            : id.includes('slide-down') ? { opacity: 0, transform: `translateY(-${distance}px)` }
                : id.includes('slide') || id.includes('fade-up') ? { opacity: 0, transform: `translateY(${distance}px)` }
                    : id.includes('zoom') || id.includes('pop') ? { opacity: 0, transform: 'scale(.72)' }
                        : id.includes('float') ? { opacity: 1, transform: `translateY(${distance / 3}px)` }
                            : { opacity: 0, transform: 'none' };
    const to: Keyframe = { opacity: 1, transform: 'none' };
    const durationMs = typeof durationSec === 'number' ? Math.min(1800, Math.max(150, durationSec * 1000)) : 650;
    return { keyframes: slot === 'out' ? [to, from] : [from, to], durationMs };
}
