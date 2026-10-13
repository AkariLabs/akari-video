import type { TransitionAlign } from '@akari-video/edit-store';

export function transitionMaterialDuration(input: {
    videoUri?: string; cached?: number | 'unavailable' | 'pending'; outSeconds: number;
}): number | undefined {
    if (!input.videoUri) return undefined;
    if (typeof input.cached === 'number') return input.cached;
    return undefined;
}

export function transitionDeclarationPatch(input: {
    type: string; duration: number; align?: TransitionAlign | null; fill?: 'freeze' | null;
}): { type: string; duration: number; align?: TransitionAlign | null; fill?: 'freeze' | null } {
    return { type: input.type, duration: input.duration,
        ...(input.align === undefined ? {} : { align: input.align }),
        ...(input.fill === undefined ? {} : { fill: input.fill }) };
}
