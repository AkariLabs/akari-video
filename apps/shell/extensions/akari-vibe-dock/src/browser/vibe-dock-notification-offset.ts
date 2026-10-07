const PROPERTIES = [
    '--akari-vibe-dock-top', '--akari-vibe-dock-left',
    '--akari-vibe-dock-toast-lift', '--akari-vibe-dock-guide-lift',
    '--akari-vibe-dock-toast-right', '--akari-vibe-dock-guide-right'
];
const WATCHED = '.akari-vibe-dock, .theia-notifications-overlay, .theia-notification-toasts, .akari-guide-announcement';

/** Publish the visible dock's viewport rectangle for the shell notification CSS. */
export class VibeDockNotificationOffset {
    private readonly resize = new ResizeObserver(() => this.schedule());
    private readonly mutations = new MutationObserver(records => {
        if (records.some(record => record.type === 'attributes' || [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)].some(node =>
            node instanceof Element && (node.matches(WATCHED) || !!node.querySelector(WATCHED))))) {
            this.schedule();
        }
    });
    private frame: number | undefined;
    private panel?: HTMLElement;
    private dock?: HTMLElement;
    private toast?: HTMLElement;
    private guide?: HTMLElement;
    private readonly onResize = (): void => this.schedule();

    constructor(private readonly host: HTMLElement) {}

    start(): void {
        this.resize.observe(this.host);
        this.mutations.observe(document.body, { childList: true, subtree: true });
        window.addEventListener('resize', this.onResize);
        this.schedule();
    }

    schedule(): void {
        if (this.frame !== undefined) return;
        this.frame = requestAnimationFrame(() => {
            this.frame = undefined;
            this.measure();
        });
    }

    dispose(): void {
        if (this.frame !== undefined) cancelAnimationFrame(this.frame);
        this.frame = undefined;
        this.resize.disconnect();
        this.mutations.disconnect();
        window.removeEventListener('resize', this.onResize);
        this.clear();
    }

    private watch(current: HTMLElement | undefined, next: HTMLElement | undefined): HTMLElement | undefined {
        if (current === next) return current;
        if (current) this.resize.unobserve(current);
        if (next) this.resize.observe(next);
        return next;
    }

    private clear(): void {
        for (const name of PROPERTIES) document.documentElement.style.removeProperty(name);
    }

    private measure(): void {
        const panel = document.querySelector<HTMLElement>('#theia-right-content-panel') ?? undefined;
        if (panel !== this.panel) {
            this.panel = this.watch(this.panel, panel);
            if (panel) this.mutations.observe(panel, { attributes: true, attributeFilter: ['class'] });
        }
        this.dock = this.watch(this.dock, this.host.querySelector<HTMLElement>('.akari-vibe-dock') ?? undefined);
        this.toast = this.watch(this.toast,
            document.querySelector<HTMLElement>('.theia-notifications-overlay .theia-notifications-container.theia-notification-toasts') ?? undefined);
        this.guide = this.watch(this.guide, document.querySelector<HTMLElement>('aside.akari-guide-announcement') ?? undefined);
        const rect = this.dock?.getBoundingClientRect();
        if (!rect || !this.dock?.isConnected || !rect.width || !rect.height || panel?.classList.contains('theia-mod-collapsed')) {
            this.clear();
            return;
        }

        const root = document.documentElement.style;
        root.setProperty('--akari-vibe-dock-top', `${rect.top}px`);
        root.setProperty('--akari-vibe-dock-left', `${rect.left}px`);
        const toastHeight = this.toast?.getBoundingClientRect().height ?? 0;
        const guideHeight = this.guide?.getBoundingClientRect().height ?? 0;
        const side = rect.top < Math.max(toastHeight, guideHeight, 120) + 16 && rect.left >= 516;
        if (side) {
            root.setProperty('--akari-vibe-dock-toast-right', `calc(100vw - var(--akari-vibe-dock-left) + 8px)`);
            root.setProperty('--akari-vibe-dock-guide-right', `calc(100vw - var(--akari-vibe-dock-left) + 8px)`);
            root.removeProperty('--akari-vibe-dock-toast-lift');
            root.removeProperty('--akari-vibe-dock-guide-lift');
        } else {
            // Theia's overlay is zero height at the window bottom. Lift both bands to
            // eight pixels above the dock while retaining each band's original baseline.
            root.setProperty('--akari-vibe-dock-toast-lift', `${Math.max(0, window.innerHeight - rect.top - 28)}px`);
            root.setProperty('--akari-vibe-dock-guide-lift', `${Math.max(0, window.innerHeight - rect.top - 12)}px`);
            root.removeProperty('--akari-vibe-dock-toast-right');
            root.removeProperty('--akari-vibe-dock-guide-right');
        }
    }
}
