/** Keeps the preview gesture's ownership paired with its final transition. */
export function createMotionDrawPointerOwnership(interaction: () => {
    setPointerOwner(owner: string): boolean;
    releasePointerOwner(owner: string): boolean;
}, owner = 'motion-draw') {
    let armed = false;
    return {
        start(): boolean {
            armed = interaction().setPointerOwner(owner);
            return armed;
        },
        stop(): void {
            if (!armed) return;
            interaction().releasePointerOwner(owner);
            armed = false;
        },
        get armed(): boolean { return armed; }
    };
}
