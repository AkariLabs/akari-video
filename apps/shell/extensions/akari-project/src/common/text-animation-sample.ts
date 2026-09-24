export interface TextAnimationSample {
    keyframes: Keyframe[];
    durationMs: number;
}

/** 棚とマイスタイルで共用する、見本文字の 1 回分の動き。 */
export function textAnimationSampleKeyframes(id: string, slot: 'in' | 'loop' | 'out', amp?: number,
    durationSec?: number): TextAnimationSample {
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
