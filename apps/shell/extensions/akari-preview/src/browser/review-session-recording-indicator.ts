import { computeIndicatorClipPath } from '../common/recording-indicator-visual';

// docs/contract-2026-08-11-review-session-ui-events.md #4: recording indicator. A fixed,
// pointer-events:none frame around the whole screen except the review (annotation) panel,
// shown/hidden exactly in sync with the recording button (setActive is driven by the same
// ReviewSessionUiState.active the review panel button renders from -- see
// akari-preview-open-handler.ts's forwardReviewSessionState). No npm dependency on
// akari-annotations: the panel is located by the data-akari-ui="panel:review" attribute that
// task registers on its own root node (same decoupling style as the BEGIN_PARTNER_ONBOARDING_
// COMMAND_ID mirror in akari-review-panel-widget.ts).
const REVIEW_PANEL_SELECTOR = '[data-akari-ui="panel:review"]';
const TRACK_INTERVAL_MS = 400;

export class ReviewSessionRecordingIndicator {
    protected readonly element: HTMLDivElement;
    protected active = false;
    protected trackTimer: number | undefined;
    protected lastClipPath = '';

    constructor() {
        this.element = document.createElement('div');
        this.element.setAttribute('data-akari-review-recording-indicator', 'true');
        this.element.setAttribute('aria-hidden', 'true');
        Object.assign(this.element.style, {
            position: 'fixed',
            inset: '0',
            zIndex: '2147483647',
            display: 'none',
            pointerEvents: 'none',
            border: '3px solid rgba(247, 137, 41, 0.92)',
            boxShadow: 'inset 0 0 26px 6px rgba(247, 137, 41, 0.55), 0 0 16px 3px rgba(247, 137, 41, 0.35)'
        });
        document.body.appendChild(this.element);
    }

    setActive(active: boolean): void {
        if (this.active === active) {
            return;
        }
        this.active = active;
        this.element.style.display = active ? 'block' : 'none';
        if (active) {
            this.updateClipPath();
            this.trackTimer = window.setInterval(() => this.updateClipPath(), TRACK_INTERVAL_MS);
        } else if (this.trackTimer !== undefined) {
            window.clearInterval(this.trackTimer);
            this.trackTimer = undefined;
        }
    }

    dispose(): void {
        if (this.trackTimer !== undefined) {
            window.clearInterval(this.trackTimer);
            this.trackTimer = undefined;
        }
        this.element.remove();
    }

    protected updateClipPath(): void {
        const panel = document.querySelector(REVIEW_PANEL_SELECTOR);
        const rect = panel instanceof HTMLElement && panel.offsetParent !== null
            ? panel.getBoundingClientRect()
            : undefined;
        const clipPath = computeIndicatorClipPath(
            rect && { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
            { width: window.innerWidth, height: window.innerHeight }
        ) ?? '';
        if (clipPath !== this.lastClipPath) {
            this.element.style.clipPath = clipPath;
            this.lastClipPath = clipPath;
        }
    }
}
