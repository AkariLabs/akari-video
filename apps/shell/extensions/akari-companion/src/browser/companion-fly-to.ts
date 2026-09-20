import { ApplicationShell } from '@theia/core/lib/browser';
import { CompanionFlyToArgs } from '../common/akari-companion-protocol';
import { buildFlyToSelector, resolveFlyToMatch } from '../common/companion-fly-to-targets';
import { CompanionPanelFrame } from './companion-panel-frame';

export interface FlyToDeps {
    doc: Document;
    win: Window;
    shell: ApplicationShell;
}

interface Point { x: number; y: number; }

export async function resolveFlyTo(
    panel: CompanionPanelFrame,
    target: CompanionFlyToArgs['target'],
    deps: FlyToDeps
): Promise<boolean> {
    const origin = panel.frameCenter();
    if (!origin) return false;

    let destination: Point | undefined;
    if (target.kind === 'previewItem') {
        const widget = deps.shell.widgets.find(candidate => {
            const configured = (candidate as unknown as { akariPreviewConfigured?: boolean }).akariPreviewConfigured === true;
            const knownId = candidate.id.startsWith('shell-tab-plugin-webview:akari-output-preview');
            return !candidate.isDisposed && candidate.isVisible && (configured || knownId);
        });
        if (!widget) return false;
        destination = centerOf(widget.node.getBoundingClientRect());
    } else {
        const selector = buildFlyToSelector(target.kind, target.id, raw => CSS.escape(raw));
        const matches = Array.from(deps.doc.querySelectorAll<HTMLElement>(selector));
        const visible = matches.map(element => ({ visible: isVisible(element) }));
        if (!resolveFlyToMatch(visible)) return false;
        destination = centerOf(matches[0].getBoundingClientRect());
    }

    await animateLight(origin, destination, deps, panel);
    return true;
}

function centerOf(bounds: DOMRect): Point {
    return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
}

function isVisible(element: HTMLElement): boolean {
    const checkVisibility = (element as HTMLElement & {
        checkVisibility?: (options?: { checkOpacity?: boolean; checkVisibilityCSS?: boolean }) => boolean;
    }).checkVisibility;
    if (checkVisibility) {
        return checkVisibility.call(element, { checkOpacity: true, checkVisibilityCSS: true });
    }
    const bounds = element.getBoundingClientRect();
    return bounds.width > 0 && bounds.height > 0 && element.offsetParent !== null;
}

async function animateLight(
    origin: Point,
    destination: Point,
    deps: FlyToDeps,
    panel: CompanionPanelFrame
): Promise<void> {
    const overlay = panel.overlayRoot();
    if (deps.win.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const ring = deps.doc.createElement('div');
        ring.className = 'akari-companion-fly-ring';
        ring.style.left = `${destination.x}px`;
        ring.style.top = `${destination.y}px`;
        overlay.append(ring);
        await waitForSingleAnimation(ring, deps.win, 550);
        ring.remove();
        return;
    }

    const dot = deps.doc.createElement('div');
    dot.className = 'akari-companion-fly-dot';
    overlay.append(dot);
    try {
        const animation = dot.animate([
            { left: `${origin.x}px`, top: `${origin.y}px`, opacity: 1 },
            { left: `${destination.x}px`, top: `${destination.y}px`, opacity: 0 }
        ], { duration: 450, easing: 'ease-in-out', fill: 'forwards' });
        await animation.finished.catch(() => undefined);
    } finally {
        dot.remove();
    }
}

function waitForSingleAnimation(element: HTMLElement, win: Window, timeoutMs: number): Promise<void> {
    return new Promise(resolve => {
        let settled = false;
        const finish = (): void => {
            if (settled) return;
            settled = true;
            win.clearTimeout(timer);
            element.removeEventListener('animationend', finish);
            resolve();
        };
        const timer = win.setTimeout(finish, timeoutMs);
        element.addEventListener('animationend', finish, { once: true });
    });
}
