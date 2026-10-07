import type { JevPlan } from '../common/jev-local-grammar';

export class JevHandGuard {
    protected readonly touched = new Map<JevPlan['surface'], number>();
    protected readonly now: () => number;
    constructor(now: () => number = Date.now) { this.now = now; }
    readonly record = (event: Event): void => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const surface: JevPlan['surface'] | undefined = target.closest('[data-akari-top-view], .theia-left-panel') ? 'left'
            : target.closest('.akari-vibe-dock, .akari-sketch-popup') ? 'paper'
                : target.closest('.theia-main, #theia-main-content-panel') ? 'main' : undefined;
        if (surface) this.touched.set(surface, this.now());
    };
    start(): void {
        for (const name of ['pointerdown', 'keydown', 'wheel']) window.addEventListener(name, this.record, true);
    }
    stop(): void {
        for (const name of ['pointerdown', 'keydown', 'wheel']) window.removeEventListener(name, this.record, true);
    }
    busy(surface: JevPlan['surface']): boolean {
        if (surface === 'settings' || surface === 'browser') return false;
        return this.now() - (this.touched.get(surface) ?? -Infinity) < 500;
    }
}
