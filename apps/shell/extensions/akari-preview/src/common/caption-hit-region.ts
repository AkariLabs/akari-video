export function captionEntryAnimationsSettled(animations: readonly Animation[]): boolean {
    for (const animation of animations) {
        const endTime = Number(animation.effect?.getComputedTiming().endTime);
        if (!Number.isFinite(endTime)) continue;
        const currentTime = Number(animation.currentTime);
        if (!Number.isFinite(currentTime) || currentTime < endTime) return false;
    }
    return true;
}
